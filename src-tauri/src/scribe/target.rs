#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};
    use std::ffi::{c_void, CString};

    type Ref = *const c_void;
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> Ref;
        fn AXUIElementCopyAttributeValue(element: Ref, name: Ref, value: *mut Ref) -> i32;
        fn AXUIElementSetAttributeValue(element: Ref, name: Ref, value: Ref) -> i32;
        fn AXUIElementPerformAction(element: Ref, action: Ref) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(allocator: Ref, string: *const i8, encoding: u32) -> Ref;
        fn CFRelease(value: Ref);
        fn CFEqual(a: Ref, b: Ref) -> u8;
        static kCFBooleanTrue: Ref;
    }

    struct Owned(Ref);
    // AX objects and immutable CF values may cross threads. AppKit calls stay on the main thread.
    unsafe impl Send for Owned {}
    unsafe impl Sync for Owned {}
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) }
        }
    }
    impl PartialEq for Owned {
        fn eq(&self, other: &Self) -> bool {
            unsafe { CFEqual(self.0, other.0) != 0 }
        }
    }
    fn string(value: &str) -> Option<Owned> {
        let value = CString::new(value).ok()?;
        let raw =
            unsafe { CFStringCreateWithCString(std::ptr::null(), value.as_ptr(), 0x08000100) };
        if raw.is_null() {
            None
        } else {
            Some(Owned(raw))
        }
    }
    fn attribute(element: &Owned, name: &str) -> Option<Owned> {
        let name = string(name)?;
        let mut value = std::ptr::null();
        let code = unsafe { AXUIElementCopyAttributeValue(element.0, name.0, &mut value) };
        if code == 0 && !value.is_null() {
            Some(Owned(value))
        } else {
            None
        }
    }

    struct Ancestor {
        element: Owned,
        title: Option<Owned>,
        url: Option<Owned>,
        document: Option<Owned>,
    }
    fn ancestors(element: &Owned) -> Vec<Ancestor> {
        let mut result = Vec::new();
        let mut parent = attribute(element, "AXParent");
        for _ in 0..24 {
            let Some(element) = parent else {
                break;
            };
            parent = attribute(&element, "AXParent");
            result.push(Ancestor {
                title: attribute(&element, "AXTitle"),
                url: attribute(&element, "AXURL"),
                document: attribute(&element, "AXDocument"),
                element,
            });
        }
        result
    }

    pub struct Target {
        pid: i32,
        pub name: String,
        application: Owned,
        window: Owned,
        element: Owned,
        value: Owned,
        selection: Option<Owned>,
        title: Option<Owned>,
        ancestors: Vec<Ancestor>,
    }
    impl Target {
        /// Capture the exact field before the Scribe panel can take focus.
        pub fn capture() -> Option<Self> {
            let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
            let pid = app.processIdentifier();
            if pid == std::process::id() as i32 {
                return None;
            }
            let raw = unsafe { AXUIElementCreateApplication(pid) };
            if raw.is_null() {
                return None;
            }
            let application = Owned(raw);
            let window = attribute(&application, "AXFocusedWindow")?;
            let element = attribute(&application, "AXFocusedUIElement")?;
            let role = attribute(&element, "AXRole");
            if !["AXTextField", "AXTextArea", "AXComboBox"]
                .iter()
                .any(|name| role == string(name))
            {
                return None;
            }
            if attribute(&element, "AXSubrole") == string("AXSecureTextField") {
                return None;
            }
            let value = attribute(&element, "AXValue")?;
            let selection = attribute(&element, "AXSelectedTextRange");
            let title = attribute(&window, "AXTitle");
            let ancestors = ancestors(&element);
            Some(Self {
                pid,
                name: app
                    .localizedName()
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                application,
                window,
                element,
                value,
                selection,
                title,
                ancestors,
            })
        }
        fn unchanged(&self) -> bool {
            attribute(&self.element, "AXValue").as_ref() == Some(&self.value)
                && attribute(&self.element, "AXSelectedTextRange") == self.selection
                && attribute(&self.window, "AXTitle") == self.title
                && self.ancestors.iter().all(|a| {
                    attribute(&a.element, "AXTitle") == a.title
                        && attribute(&a.element, "AXURL") == a.url
                        && attribute(&a.element, "AXDocument") == a.document
                })
        }
        /// Restore only the captured field. Call on the main thread.
        pub fn restore(&self) -> Result<(), String> {
            if !self.unchanged() {
                return Err("destination_changed".into());
            }
            let app = NSRunningApplication::runningApplicationWithProcessIdentifier(self.pid)
                .ok_or("destination_closed")?;
            #[allow(deprecated)]
            if !app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps) {
                return Err("destination_unavailable".into());
            }
            let raise = string("AXRaise").ok_or("destination_unavailable")?;
            let focused = string("AXFocused").ok_or("destination_unavailable")?;
            unsafe {
                AXUIElementPerformAction(self.window.0, raise.0);
                AXUIElementSetAttributeValue(self.element.0, focused.0, kCFBooleanTrue);
            }
            Ok(())
        }
        /// Verify immediately before the paste chord. Call on the main thread.
        pub fn verify(&self) -> bool {
            NSWorkspace::sharedWorkspace()
                .frontmostApplication()
                .is_some_and(|app| app.processIdentifier() == self.pid)
                && attribute(&self.application, "AXFocusedWindow").as_ref() == Some(&self.window)
                && attribute(&self.application, "AXFocusedUIElement").as_ref()
                    == Some(&self.element)
                && self.unchanged()
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub struct Target {
        pub name: String,
    }
    impl Target {
        pub fn capture() -> Option<Self> {
            None
        }
        pub fn restore(&self) -> Result<(), String> {
            Err("unsupported_platform".into())
        }
        pub fn verify(&self) -> bool {
            false
        }
    }
}
pub use platform::Target;
