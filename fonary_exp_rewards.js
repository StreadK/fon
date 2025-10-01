/*:
 * @target MZ
 * @plugindesc Pokémon-style EXP on KO (Gen5/Gen3, trainer bonus, participants-only). Silences EXP & level-up messages during battle to prevent trainer double-send.
 * @author You
 * @help
 * - EXP is awarded immediately when an enemy faints.
 * - Gen 5 scaled or Gen 3 flat formulas.
 * - Trainer bonus via switch or <TrainerBattle> troop tag.
 * - Participants-only split.
 * - HARD-DISABLES vanilla end-of-battle EXP to avoid doubles.
 * - NEW: Suppresses all EXP/level-up messages while in battle (prevents re-send bug).
 *
 * ACTOR (species) notes:
 *   <SpeciesId: FLAMLET>
 *   <BaseExp: 62>            # base yield like Pokémon
 *
 * ENEMY notes:
 *   <SpeciesId: FLAMLET>     # to look up BaseExp from the species actor
 *
 * TROOP note (optional):
 *   <TrainerBattle>
 *
 * @param Method
 * @type select
 * @option Gen5 (Scaled)
 * @value Gen5
 * @option Gen3 (Flat)
 * @value Gen3
 * @default Gen5
 *
 * @param TrainerBonus
 * @type number
 * @decimals 2
 * @default 1.5
 *
 * @param TrainerSwitchId
 * @type switch
 * @default 0
 *
 * @param SplitByParticipants
 * @type boolean
 * @default true
 *
 * @param ParticipantsOnly
 * @type boolean
 * @default true
 *
 * @param DefaultBaseExp
 * @type number
 * @min 1
 * @default 50
 *
 * @param DisableVanillaVictoryExp
 * @type boolean
 * @default true
 *
 * @param SuppressBattleMessages
 * @text Suppress EXP/LevelUp messages in battle
 * @type boolean
 * @default true
 *
 * @param ZeroEnemyExpOnLoad
 * @text Set all Enemy EXP to 0 on load
 * @type boolean
 * @default true
 *
 * @param OverrideTroopExpTotal
 * @text Force Game_Troop.expTotal() to 0
 * @type boolean
 * @default true
 *
 * @param OverrideGainExp
 * @text Force BattleManager.gainExp() to no-op
 * @type boolean
 * @default true
 *
 * @param ZeroRewardsExp
 * @text Force rewards.exp = 0 in makeRewards
 * @type boolean
 * @default true
 */

(() => {
  "use strict";

  const PN = "fonary_exp_awards_mz";
  const P  = PluginManager.parameters(PN);

  const METHOD         = String(P.Method || "Gen5");
  const TRAINER_BONUS  = Number(P.TrainerBonus || 1.5);
  const TRAINER_SW     = Number(P.TrainerSwitchId || 0);
  const SPLIT_PART     = String(P.SplitByParticipants || "true") === "true";
  const PART_ONLY      = String(P.ParticipantsOnly || "true") === "true";
  const DEFAULT_BASE   = Math.max(1, Number(P.DefaultBaseExp || 50));
  const DISABLE_VANILLA= String(P.DisableVanillaVictoryExp || "true") === "true";

  const SUPPRESS_BATTLE_MSGS = String(P.SuppressBattleMessages || "true") === "true";

  const ZERO_ENEMY_EXP_ON_LOAD = String(P.ZeroEnemyExpOnLoad || "true") === "true";
  const OVERRIDE_TROOP_EXP     = String(P.OverrideTroopExpTotal || "true") === "true";
  const OVERRIDE_GAIN_EXP      = String(P.OverrideGainExp || "true") === "true";
  const ZERO_REWARDS_EXP       = String(P.ZeroRewardsExp || "true") === "true";

  // ------------ helpers ------------
  function readTag(note, tag){
    const re = new RegExp("<"+tag+":\\s*([^>]+)\\s*>","i");
    const m = (note||"").match(re);
    return m ? String(m[1]).trim() : "";
  }
  const inBattle = () => $gameParty.inBattle && $gameParty.inBattle();

  // Build species map from ACTORS
  const SPECIES = {}; // { id: { baseExp } }
  function parseSpeciesFromActors(){
    if (!$dataActors) return;
    for (let i=1;i<$dataActors.length;i++){
      const a = $dataActors[i];
      if (!a) continue;
      const sid = readTag(a.note, "SpeciesId");
      if (!sid) continue;
      const be = Number(readTag(a.note,"BaseExp")||0)|0;
      SPECIES[String(sid)] = { baseExp: Math.max(0, be) };
    }
  }

  const _DM_onLoad = DataManager.onLoad;
  DataManager.onLoad = function(object){
    _DM_onLoad.call(this, object);
    if (object === $dataActors) parseSpeciesFromActors();
    if (ZERO_ENEMY_EXP_ON_LOAD && object === $dataEnemies) {
      for (let i=1;i<object.length;i++){
        const e = object[i];
        if (e && typeof e.exp === "number") e.exp = 0;
      }
    }
  };

  function speciesIdOfEnemy(ge){
    const obj = ge?.enemy?.(); if (!obj) return "";
    let sid = readTag(obj.note, "SpeciesId");
    if (!sid && ge._fonarySpeciesId) sid = String(ge._fonarySpeciesId);
    if (!sid) sid = ge.name ? ge.name() : "";
    return String(sid||"");
  }
  function baseExpForEnemy(ge){
    const sid = speciesIdOfEnemy(ge);
    if (sid && SPECIES[sid] && SPECIES[sid].baseExp > 0) return SPECIES[sid].baseExp;
    return DEFAULT_BASE;
  }
  function enemyLevel(ge){
    return ge.level ? ge.level : (ge._fonaryLevelOverride || 1);
  }
  function isTrainerBattle(){
    if (TRAINER_SW > 0 && $gameSwitches.value(TRAINER_SW)) return true;
    const t = $gameTroop && $gameTroop.troop();
    if (t && /<TrainerBattle>/i.test(t.note||"")) return true;
    if ($gameTroop && $gameTroop._fonaryTrainerBattle) return true;
    return false;
  }

  // participants tracking
  function resetParticipants(){ $gameParty._fon_participants = new Set(); }
  function addParticipant(actor){
    if (actor && actor.isActor && actor.isActor()) {
      $gameParty._fon_participants = $gameParty._fon_participants || new Set();
      $gameParty._fon_participants.add(actor.actorId());
    }
  }
  function participantsArray(){
    const s = $gameParty._fon_participants instanceof Set ? $gameParty._fon_participants : new Set();
    const arr = Array.from(s).map(id => $gameActors.actor(id)).filter(a => a && a.isAlive());
    return arr.length ? arr : $gameParty.aliveMembers();
  }

  const _BM_setup = BattleManager.setup;
  BattleManager.setup = function(troopId, canEscape, canLose){
    _BM_setup.call(this, troopId, canEscape, canLose);
    resetParticipants();
  };
  const _BM_startAction = BattleManager.startAction;
  BattleManager.startAction = function(){
    _BM_startAction.call(this);
    const subj = this._subject;
    if (subj && subj.isActor && subj.isActor()) addParticipant(subj);
  };

  // ---------- EXP formulas ----------
  function expGen3({a,b,L,s}){
    const base = Math.floor((a * b * L) / 7);
    return Math.floor(base / Math.max(1,s));
  }
  function expGen5({a,b,L,s}, Lp){
    const num = a * b * L / 5;
    const ratio = Math.pow((2*L + 10), 2.5) / Math.pow((L + Lp + 10), 2.5);
    const raw = Math.floor(num * ratio + 1);
    return Math.floor(raw / Math.max(1,s));
  }

  // ---------- Award on KO ----------
  function awardExpOnEnemyKO(enemy){
    if (!enemy || enemy._fonExpGiven) return;
    enemy._fonExpGiven = true;

    const b = baseExpForEnemy(enemy);
    const L = Math.max(1, enemyLevel(enemy));
    const a = isTrainerBattle() ? TRAINER_BONUS : 1.0;

    let recipients = PART_ONLY ? participantsArray() : $gameParty.aliveMembers();
    const s = recipients.length || 1;
    if (!recipients.length) return;

    for (const actor of recipients) {
      const Lp = Math.max(1, actor.level || 1);
      const exp = Math.max(1,
        METHOD === "Gen3" ? expGen3({a,b,L,s}) : expGen5({a,b,L,s}, Lp)
      );
      // give EXP silently; level-up messages are suppressed below
      actor.gainExp(exp);
    }
  }

  const _GE_die = Game_Enemy.prototype.die;
  Game_Enemy.prototype.die = function(){
    try { awardExpOnEnemyKO(this); } catch(e){ console.error(e); }
    _GE_die.call(this);
  };

  // ---------- Silence EXP and LevelUp messages DURING battle ----------
  if (SUPPRESS_BATTLE_MSGS) {
    // 1) EXP message suppression (we're not adding any in this plugin)

    // 2) Level-up message suppression:
    const _GA_displayLevelUp = Game_Actor.prototype.displayLevelUp;
    Game_Actor.prototype.displayLevelUp = function(newSkills){
      if (inBattle()) {
        // Do nothing in battle to avoid interfering with trainer send-out flow.
        // (Optional: queue to show on map later.)
        return;
      }
      _GA_displayLevelUp.call(this, newSkills);
    };
  }

  // ---------- Nuke vanilla EXP pathways ----------
  if (OVERRIDE_TROOP_EXP) {
    Game_Troop.prototype.expTotal = function(){ return 0; };
  }
  if (OVERRIDE_GAIN_EXP && DISABLE_VANILLA) {
    BattleManager.gainExp = function(){ /* no-op: handled on KO */ };
  }
  if (ZERO_REWARDS_EXP) {
    const _BM_makeRewards = BattleManager.makeRewards;
    BattleManager.makeRewards = function(){
      _BM_makeRewards.call(this);
      if (this._rewards) this._rewards.exp = 0;
    };
  }

})();
