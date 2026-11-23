//! Cantrip Realms' gear (realms/docs/gear.md) is what its content says: every item of `realms/content/gear` with effects has
//! its emblem in the card table - "<name> (gear)", typeless (CR 114.1), an ability for each effect, its text the item's
//! effect lines - and an item with none has no emblem. The emblems are generated from the content
//! (`tools/realms/gear-cards.py`); this fails when the two have drifted apart, an emblem left behind or one never written.

use std::fs;
use std::path::Path;

use cantrip_api::*;

#[test]
fn every_gear_item_with_effects_has_its_emblem_and_no_other_has_one() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../realms/content/gear");
    let cards = cantrip_cards::all();
    let mut items = 0;
    let mut emblems = Vec::new();
    for entry in fs::read_dir(&dir).expect("realms/content/gear").flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let item: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let name = format!("{} (gear)", item["name"].as_str().unwrap());
        let effects = item["effects"].as_array().map_or(0, Vec::len);
        let found: Vec<&CardDef> = cards.iter().copied().filter(|c| c.name == name).collect();
        items += 1;
        if effects == 0 {
            assert!(found.is_empty(), "{}: an item with no effects has no emblem", path.display());
            continue;
        }
        let [emblem] = found[..] else { panic!("{}: one emblem named \"{name}\", not {}", path.display(), found.len()) };
        assert_eq!(emblem.types, TypeSet::NONE, "{name} is an emblem, of no card type");
        assert!(!emblem.has_cost, "{name} has no mana cost");
        assert_eq!(emblem.abilities.len(), effects, "{name}: an ability for each effect line");
        let text = item["text"].as_str().unwrap();
        assert!(text.ends_with(emblem.text), "{name}: the item's text ends with its emblem's ({:?} / {:?})", text, emblem.text);
        emblems.push(name);
    }
    assert!(items > 0, "the gear content was not found");
    // No emblem of an item that is gone: every "(gear)" definition but the families' test emblems is an item's.
    for card in cards.iter().filter(|c| c.name.ends_with(" (gear)")) {
        assert!(emblems.iter().any(|e| e == card.name), "\"{}\" is no gear item's emblem", card.name);
    }
}
