// GPU pipelines compile on first use. Exercise both casts in a real Bevy arena.
export async function checkAvitaShaders(evaluate, sleep) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.viewport.bevy-active'))")) break;
    await sleep(100);
  }
  return evaluate(`(async () => {
    if (!document.querySelector('.viewport.bevy-active')) throw Error('Bevy arena did not start');
    document.querySelectorAll('#drivers button')[8].click();
    const world = __game.race;
    if (world.driver !== 8) throw Error('Avita was not selected');
    world.phase = 'racing';
    for (const bot of world.bots) bot.inactive = true;
    const {useSpecial} = await import('/gameplay/special-abilities.js');
    const {useBattleTurbo} = await import('/gameplay/combat.js');
    if (!useSpecial(world) || world.timeStop <= 0) throw Error('Special Relativity failed to activate');
    await new Promise(done => setTimeout(done, 4000));
    useBattleTurbo(world); useBattleTurbo(world);
    if (!(world.nightmareActive > 0)) throw Error('Wormhole failed to activate');
    await new Promise(done => setTimeout(done, 4000));
    return {scenario:'avita-shaders', pass:Boolean(document.querySelector('.viewport.bevy-active'))};
  })()`);
}
