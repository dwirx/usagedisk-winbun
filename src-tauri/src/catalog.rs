use std::sync::OnceLock;

use crate::types::Target;

static TARGETS: OnceLock<Vec<Target>> = OnceLock::new();

pub fn targets() -> &'static [Target] {
    TARGETS
        .get_or_init(|| {
            serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/targets.json")))
                .expect("generated target catalog is invalid")
        })
        .as_slice()
}

pub fn target_by_id(id: &str) -> Option<Target> {
    targets().iter().find(|target| target.id == id).cloned()
}
