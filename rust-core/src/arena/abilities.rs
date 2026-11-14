//! Switches for each racer's abilities, numbered as gameplay/special-abilities.js
//! lists them: 0 is the first (usually the F-key special), 1 the additional one.
//! Every ability is always on in the game; the check compiles away outside
//! tests. The ability-importance simulation switches them off per racer seat.
#[cfg(not(test))]
#[inline(always)]
pub(super) fn ability_on(_actor: usize, _ability: u8) -> bool {
    true
}
#[cfg(test)]
thread_local! {
    /// Per actor, a bit for every ability that is switched off.
    pub(super) static DISABLED: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}
#[cfg(test)]
pub(super) fn ability_on(actor: usize, ability: u8) -> bool {
    DISABLED.with(|off| off.borrow().get(actor).is_none_or(|bits| bits & (1 << ability) == 0))
}
