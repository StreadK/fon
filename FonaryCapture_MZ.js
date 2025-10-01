/*:
 * @target MZ
 * @plugindesc Capture duplicates like Pokémon: use shell actor pool (IDs range). Plugin cmd: FonaryCaptureFromEnemy.
 * @help
 * 1) Make blank "shell" actors in the database, e.g., IDs 101–300.
 * 2) Tag capturable ENEMIES with:
 *      <SpeciesId: FLAMISH>
 *      <DefaultLevel: 5>
 *      <Face: FlamishFace>       // optional (img/faces)
 *      <SVBattler: FlamishSV>    // optional (img/sv_actors)
 *      <Character: FlamishChar>  // optional (img/characters)
 * 3) On capture success, call plugin command:
 *      FonaryCaptureFromEnemy enemySlot:1
 *
 * This will:
 *  - Find first free shell actor in the configured range.
 *  - Stamp its data (name/species/level/images) from the enemy notetags.
 *  - Add it to the party (or show "team full").
 *
 * You can safely catch duplicates: each capture uses a different shell ID.
 *
 * @param ShellStartId
 * @text Shell Start Actor ID
 * @type actor
 * @default 101
 *
 * @param ShellEndId
 * @text Shell End Actor ID
 * @type actor
 * @default 300
 *
 * @param TeamLimit
 * @text Team Size Limit
 * @type number
 * @min 1
 * @default 6
 *
 * @param TeamFullMessage
 * @text Team Full Message
 * @type string
 * @default Your team is full!
 *
 * @command FonaryCaptureFromEnemy
 * @text Capture From Enemy (slot)
 * @desc Capture the enemy in a given troop slot (1..8), using its <SpeciesId> and other tags.
 *
 * @arg enemySlot
 * @text Enemy Slot (1..8)
 * @type number
 * @min 1
 * @max 8
 * @default 1
 */

(() => {
  const PLUGIN_NAME = "FonaryCapture_MZ";
  const params = PluginManager.parameters(PLUGIN_NAME);
  const SHELL_START = Number(params["ShellStartId"] || 101);
  const SHELL_END   = Number(params["ShellEndId"]   || 300);
  const TEAM_LIMIT  = Number(params["TeamLimit"]    || 6);
  const MSG_TEAM_FULL = String(params["TeamFullMessage"] || "Your team is full!");

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------
  const partyActorIds = () => $gameParty._actors.slice();
  const partySize = () => partyActorIds().length;

  // Treat a shell actor as "free" if it is not in party and not flagged as occupied.
  function isShellFree(actorId) {
    if (!$dataActors[actorId]) return false;
    // If actor is in party already, it's not free.
    if ($gameParty._actors.includes(actorId)) return false;
    // If actor exists in $gameActors and is flagged as captured, it's taken.
    const a = $gameActors.actor(actorId);
    return !(a && a._fonary && a._fonary.captured);
  }

  function findFreeShellId() {
    for (let id = SHELL_START; id <= SHELL_END; id++) {
      if (isShellFree(id)) return id;
    }
    return 0;
  }

  // Stamp species data onto a shell actor
  function stampShellAsCaptured(actorId, speciesId, name, level, images) {
    const a = $gameActors.actor(actorId);

    // Mark occupancy & species data
    a._fonary = a._fonary || {};
    a._fonary.captured  = true;
    a._fonary.speciesId = speciesId;
    a._fonary.level     = level;

    // Name (use species name by default)
    a.setName(name || speciesId);

    // Level
    a.changeLevel(Math.max(1, level|0), false);

    // Images (optional)
    if (images) {
      if (images.face)    a.setFaceImage(images.face, 0);
      if (images.sv)      a.setBattlerImage(images.sv);
      if (images.char)    a.setCharacterImage(images.char, 0);
    }

    // Reset HP/MP to full on obtain (you can change this rule)
    a.recoverAll();
  }

  // Build images object from enemy meta
  function imagesFromEnemyMeta(enemy) {
    const m = enemy.meta || {};
    const face = m.Face ? String(m.Face) : null;
    const sv   = m.SVBattler ? String(m.SVBattler) : null;
    const chr  = m.Character ? String(m.Character) : null;
    return { face: face, sv: sv, char: chr };
  }

  // ---------------------------------------------------------------------------
  // Plugin Command: FonaryCaptureFromEnemy
  // ---------------------------------------------------------------------------
  PluginManager.registerCommand(PLUGIN_NAME, "FonaryCaptureFromEnemy", args => {
    const slot = Math.max(1, Math.min(8, Number(args.enemySlot || 1)));
    const enemy = $gameTroop.members()[slot - 1];

    if (!enemy || !enemy.isAlive()) {
      $gameMessage.add("Capture failed: no enemy in that slot.");
      return;
    }

    const dataEnemy = $dataEnemies[enemy.enemyId()];
    const speciesId = (dataEnemy.meta && (dataEnemy.meta.SpeciesId || dataEnemy.meta.speciesId)) || "";
    if (!speciesId) {
      $gameMessage.add("Capture failed: Enemy has no <SpeciesId: ...> tag.");
      return;
    }

    // Pick display name (you can change to a pretty map later)
    const displayName = dataEnemy.name || String(speciesId);

    // Level
    const defaultLv = Number((dataEnemy.meta && (dataEnemy.meta.DefaultLevel || dataEnemy.meta.Level)) || 5);
    const level = Math.max(1, defaultLv|0);

    // Team room?
    if (partySize() >= TEAM_LIMIT) {
      $gameMessage.add(String(MSG_TEAM_FULL));
      return;
    }

    // Find a free shell actor
    const shellId = findFreeShellId();
    if (!shellId) {
      $gameMessage.add("No free shells available. Extend your shell actor range.");
      return;
    }

    // Stamp and add to party
    const images = imagesFromEnemyMeta(dataEnemy);
    stampShellAsCaptured(shellId, String(speciesId), displayName, level, images);
    $gameParty.addActor(shellId);

    // Optional: KO the enemy you caught (if you're calling this mid-battle)
    if (enemy.hp > 0) enemy.addState(enemy.deathStateId());

    // Feedback
    $gameMessage.add(`${displayName} was captured!`);
  });

})();
