//! Cantrip Realms' gear (realms/docs/gear.md): the effect families a worn item's emblem is built from, each a `const fn`
//! that makes one ability from its parameters (const generics, since a trigger's matcher, its intervening "if" and its
//! effect are plain `fn` pointers) and the text the generator writes for it. This file is the fork's alone and defines no
//! card: each item's emblem is its own file, `realm_gear_<item>.rs`, and the emblems the families' scenarios deal are
//! `realm_gear_families.rs`, both written by `tools/realms/gear-cards.py` from `realms/content/gear/*.json` - which says
//! which family each line is, with what parameters - and never edited by hand.
//!
//! An emblem is in its owner's command zone from before the game begins (CR 114.4, 902.3: `SeatVariant::emblems`), where its
//! abilities function (CR 113.6p). Each family is built only from what the engine and the shared mechanics already do;
//! "your Nth turn" is asked of the history's turn records, never of a counter.

use cantrip_api::*;
use cantrip_mechanics::{effects, players, prevention, tokens, triggers};

// --- Turns ---------------------------------------------------------------------------------------------------------

/// How many turns `player` has begun this game, the one in progress included (CR 500.1): the history's `Event::TurnBegan`
/// records of theirs, an extra turn (CR 500.7) counting as one and a skipped turn (CR 614.10), which never begins, not at all.
pub fn turns_begun(q: &dyn Query, player: PlayerId) -> usize {
    q.history().count(EventQuery::kind(EventMask::TURN_BEGAN).player(player))
}

/// "If it's your Nth turn" (CR 603.4): it is the emblem's controller's turn, and the `N`th they have begun this game.
pub fn your_nth_turn<const N: u32>(q: &dyn Query, asker: &Asker) -> bool {
    q.state().turn.active == asker.controller && turns_begun(q, asker.controller) == N as usize
}

/// "If it's that player's Nth turn" (CR 603.4), that player the opponent whose upkeep began (`each_opponents_upkeep`): the
/// turn in progress is an opponent's, and the `N`th they have begun this game.
pub fn that_players_nth_turn<const N: u32>(q: &dyn Query, asker: &Asker) -> bool {
    let active = q.state().turn.active;
    active != asker.controller && turns_begun(q, active) == N as usize
}

/// "At the beginning of each opponent's upkeep" (CR 503.1a, 603.2), about that player: the trigger's subject is the opponent
/// whose upkeep it is, the "that player" of what it does.
fn each_opponents_upkeep_about_them(q: &dyn Query, me: &Asker, event: &Event) -> Option<Fired> {
    triggers::each_opponents_upkeep(q, me, event)?;
    Fired::about(Target::Player(q.state().turn.active))
}

const EACH_OPPONENTS_UPKEEP: Trigger = when_asked(EventMask::STEP_BEGAN, each_opponents_upkeep_about_them);

/// The opponent a trigger of `EACH_OPPONENTS_UPKEEP` is about, if they are still in the game (CR 800.4a).
fn that_player(g: &mut dyn Game, item: &StackItem) -> Option<PlayerId> {
    item.subject.player().filter(|&player| players::reached(g, player))
}

// --- Effects -------------------------------------------------------------------------------------------------------

/// "Draw K cards" (CR 121.1).
fn draw<const K: u32>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    effects::draw(g, item, K)
}

/// "Scry K" (CR 701.22): an empty library is a scry of nothing, still a scry (CR 701.22d).
fn scry<const K: usize>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    effects::scry(g, item, K)
}

/// "Surveil K" (CR 701.25).
fn surveil<const K: usize>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    effects::surveil(g, item, K)
}

/// "Add M": `AMOUNT` mana of `Mana::ALL[MANA]` (W, U, B, R, G, C), into its controller's pool (CR 106.3), which empties at
/// the end of the step or phase (CR 500.4). A triggered ability that adds mana is no mana ability: it uses the stack (CR
/// 605.1b).
fn add_mana<const MANA: u8, const AMOUNT: u32>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    const { assert!(MANA < 6, "a mana index is one of W, U, B, R, G, C") };
    g.add_mana(item.controller, Mana::ALL[MANA as usize], AMOUNT);
    Ok(())
}

/// "You may play an additional land this turn" (CR 305.2): a permission until the turn ends (CR 611.2c).
fn additional_land(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    g.additional_land_plays(item, 1);
    Ok(())
}

/// "Put K +1/+1 counters on it", "it" the creature the trigger is about: nothing if it has left the battlefield, a new
/// object (CR 400.7, 608.2b).
fn counters_on_it<const K: i32>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    let Some(creature) = item.subject.object().filter(|&p| cantrip_mechanics::targets::permanent(g, p)) else { return Ok(()) };
    g.add_counters(creature, CounterKind::PlusOne, K);
    Ok(())
}

/// "It gains haste until end of turn" (CR 702.10, 611.2a), "it" the creature the trigger is about.
fn haste_on_it(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    let Some(creature) = item.subject.object() else { return Ok(()) };
    cantrip_mechanics::haste_until_end_of_turn(g, item.object, creature);
    Ok(())
}

/// The tokens `token_on_turn` makes, by index, as `tools/realms/gear-cards.py` numbers them: each the shared definition its
/// text names (CR 111.4), listed in the emblem's own `EXTRA` beside it.
pub static TOKENS: [&CardDef; 5] =
    [&tokens::SOLDIER, &tokens::GOBLIN, &tokens::ELF_WARRIOR, &tokens::WHITE_FLYING_SPIRIT, &tokens::THOPTER];

/// "Create a [token]" (CR 111.1): one of `TOKENS[T]`, under the ability's controller.
fn create_token<const T: usize>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    tokens::create(g, item.controller, TOKENS[T], 1)?;
    Ok(())
}

/// "You gain K life" (CR 119.3).
fn gain_life<const K: i32>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    effects::gain_life(g, item, K)
}

/// "Prevent all damage that would be dealt to you this turn" (CR 615.1a, 615.3): a prevention effect of the ability's own
/// until the turn ends, whatever becomes of its source; damage that can't be prevented is dealt (CR 615.12). The emblem
/// lists `PREVENTION` first in its `granted_preventions`.
fn prevent_damage_to_you(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    prevention::this_turn(g, item, Target::Player(item.controller), 0, Shield::All);
    Ok(())
}

/// The prevention effect `prevent_damage_on_turn` makes: an emblem with that family lists it first (and only) in its
/// `granted_preventions`.
pub const PREVENTION: GrantedPreventionDef = prevention::ANY_DAMAGE.text("Prevent all damage that would be dealt to you this turn.");

/// "That player discards a card" (CR 701.9): the opponent chooses it; nothing is asked of an empty hand.
fn that_player_discards(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    let Some(player) = that_player(g, item) else { return Ok(()) };
    cantrip_mechanics::each_discards_a_card(g, &[player], item.object)?;
    Ok(())
}

/// "That player mills K cards" (CR 701.17): as many as their library holds, if fewer (CR 701.17b).
fn that_player_mills<const K: u32>(g: &mut dyn Game, item: &StackItem) -> Result<(), Suspend> {
    let Some(player) = that_player(g, item) else { return Ok(()) };
    g.mill(player, K);
    Ok(())
}

// --- The first creature --------------------------------------------------------------------------------------------

/// "Whenever a creature you control enters, if it's the first creature to enter the battlefield under your control this
/// game" (CR 603.6a, 603.4): a creature entering under the emblem's controller's control when no creature has entered under
/// their control before it this game - the history's `Event::Entered` records, each kept with its controller and types as it
/// entered. The history a trigger is matched against ends before the events being matched, so creatures entering together
/// as the first are each the first (no creature entered before either). Once true of a creature it stays true, so asking it
/// again as the ability resolves (CR 603.4) could never answer otherwise.
fn first_creature_you_control_enters(q: &dyn Query, me: &Asker, event: &Event) -> Option<Fired> {
    let fired = triggers::creature_you_control_enters(q, me, event)?;
    let earlier = q.history().all().iter().any(|r| {
        matches!(r.event, Event::Entered { controller, types, .. } if controller == me.controller && types.has(CardType::Creature))
    });
    if earlier { None } else { Some(fired) }
}

const FIRST_CREATURE_YOU_CONTROL_ENTERS: Trigger = when_asked(EventMask::ZONE_CHANGE, first_creature_you_control_enters);

// --- The families (realms/docs/gear.md) ----------------------------------------------------------------------------

/// `draw-on-turn`: "At the beginning of your draw step, if it's your Nth turn, draw K cards."
pub const fn draw_on_turn<const N: u32, const K: u32>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_DRAW_STEP, draw::<K>, text).condition(your_nth_turn::<N>)
}

/// `scry-on-turn`: "At the beginning of your upkeep, if it's your Nth turn, scry K."
pub const fn scry_on_turn<const N: u32, const K: usize>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_UPKEEP, scry::<K>, text).condition(your_nth_turn::<N>)
}

/// `surveil-on-turn`: "At the beginning of your upkeep, if it's your Nth turn, surveil K."
pub const fn surveil_on_turn<const N: u32, const K: usize>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_UPKEEP, surveil::<K>, text).condition(your_nth_turn::<N>)
}

/// `mana-on-turn`: "At the beginning of your precombat main phase, if it's your Nth turn, add M." (CR 505.1a: the first
/// main phase of a turn is its precombat main phase.)
pub const fn mana_on_turn<const N: u32, const MANA: u8, const AMOUNT: u32>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_FIRST_MAIN_PHASE, add_mana::<MANA, AMOUNT>, text).condition(your_nth_turn::<N>).produces_mana()
}

/// `extra-land-on-turn`: "At the beginning of your upkeep, if it's your Nth turn, you may play an additional land this
/// turn." (A static "you may play an additional land on your Nth turn" is no ability an emblem's land plays count: the
/// engine counts a player's play rules from the battlefield alone.)
pub const fn extra_land_on_turn<const N: u32>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_UPKEEP, additional_land, text).condition(your_nth_turn::<N>)
}

/// `first-creature-haste`: "Whenever a creature you control enters, if it's the first creature to enter the battlefield
/// under your control this game, it gains haste until end of turn."
pub const fn first_creature_haste(text: &'static str) -> AbilityDef {
    triggered(FIRST_CREATURE_YOU_CONTROL_ENTERS, haste_on_it, text)
}

/// `counters-first-creature`: "Whenever a creature you control enters, if it's the first creature to enter the battlefield
/// under your control this game, put K +1/+1 counters on it."
pub const fn counters_first_creature<const K: i32>(text: &'static str) -> AbilityDef {
    triggered(FIRST_CREATURE_YOU_CONTROL_ENTERS, counters_on_it::<K>, text)
}

/// `token-on-turn`: "At the beginning of your upkeep, if it's your Nth turn, create [the token `TOKENS[T]`]."
pub const fn token_on_turn<const N: u32, const T: usize>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_UPKEEP, create_token::<T>, text).condition(your_nth_turn::<N>)
}

/// `gain-life-on-turn`: "At the beginning of your upkeep, if it's your Nth turn, you gain K life."
pub const fn gain_life_on_turn<const N: u32, const K: i32>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_UPKEEP, gain_life::<K>, text).condition(your_nth_turn::<N>)
}

/// `prevent-damage-on-turn`: "At the beginning of your upkeep, if it's your Nth turn, prevent all damage that would be
/// dealt to you this turn." (A static prevention effect functions only from the battlefield, CR 604.1's reading in the
/// engine, so the emblem's is made by a triggered ability for the turn, CR 615.3.)
pub const fn prevent_damage_on_turn<const N: u32>(text: &'static str) -> AbilityDef {
    triggered(triggers::YOUR_UPKEEP, prevent_damage_to_you, text).condition(your_nth_turn::<N>)
}

/// `opponent-discards-on-turn`: "At the beginning of each opponent's upkeep, if it's that player's Nth turn, that player
/// discards a card."
pub const fn opponent_discards_on_turn<const N: u32>(text: &'static str) -> AbilityDef {
    triggered(EACH_OPPONENTS_UPKEEP, that_player_discards, text).condition(that_players_nth_turn::<N>)
}

/// `opponent-mills-on-turn`: "At the beginning of each opponent's upkeep, if it's that player's Nth turn, that player mills
/// K cards."
pub const fn opponent_mills_on_turn<const N: u32, const K: u32>(text: &'static str) -> AbilityDef {
    triggered(EACH_OPPONENTS_UPKEEP, that_player_mills::<K>, text).condition(that_players_nth_turn::<N>)
}
