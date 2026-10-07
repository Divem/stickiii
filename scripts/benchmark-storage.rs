#![allow(dead_code)]
#[path = "../src-tauri/src/recovery.rs"]
mod recovery;
#[path = "../src-tauri/src/storage.rs"]
mod storage;
use serde_json::{json, Value};
fn main() {
    for (count, images) in [(1000, 0), (5000, 0), (1000, 20), (5000, 20)] {
        let temp = tempfile::tempdir().unwrap();
        let mut store = storage::Store::load(temp.path().into(), None).unwrap();
        let mut notes:Vec<Value>=(0..count).map(|i| json!({"id":format!("n{i}"),"content":"a".repeat(2048),"attachments":[],"createdAt":"old","updatedAt":"old","syncState":"local"})).collect();
        if images > 0 {
            let file = temp.path().join("attachments/fixture.png");
            std::fs::write(&file, b"fixture").unwrap();
            for i in 0..images {
                notes[i]["attachments"] = json!([{"id":format!("a{i}"),"name":"fixture.png","mimeType":"image/png","size":1048576,"storedPath":file,"previewDataUrl":format!("data:image/png;base64,{}","A".repeat(1398104))}]);
            }
        }
        store.replace(notes).unwrap();
        let mib = std::fs::metadata(temp.path().join("notes.json"))
            .unwrap()
            .len() as f64
            / 1048576.0;
        let mut times = vec![];
        for i in 0..7 {
            let mut note = store
                .notes
                .iter()
                .find(|n| n["id"] == "n999")
                .unwrap()
                .clone();
            note["content"] = json!(format!("{}-{i}", "a".repeat(2048)));
            let start = std::time::Instant::now();
            store.save(note).unwrap();
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        let start = std::time::Instant::now();
        let loaded = storage::Store::load(temp.path().into(), None).unwrap();
        let load = start.elapsed().as_secs_f64() * 1000.0;
        drop(loaded);
        println!("count={count} previews={images} notesMiB={mib:.2} saveMedianMs={:.2} saveMaxMs={:.2} loadMs={load:.2}",times[3],times[6]);
    }
}
