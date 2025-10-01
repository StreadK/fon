/*:
 * @target MZ
 * @plugindesc Pokémon-like battle with a non-battling Trainer in party slot 0. Trainer excluded from battles/swap/defeat/status. Safe with 0 fonaries; player visibility restored.
 * @help
 * - Put the Trainer as the FIRST party member (party index 0).
 * - Max Battle Members can be 1.
 * - Map visibility is enforced: trainer is always visible outside battle.
 */

(() => {
  // ------------------ Party helpers (trainer-aware) -------------------------
  const partyIdsAll = () => $gameParty._actors.slice();             // [trainer, f1, f2, ...]
  const trainerId   = () => partyIdsAll()[0] || 0;
  const nonTrainerIds   = () => partyIdsAll().slice(1);
  const nonTrainerCount = () => Math.max(0, $gameParty._actors.length - 1);
  const nonTrainerAlive = () =>
    nonTrainerIds().some(id => { const a = $gameActors.actor(id); return a && a.isAlive && a.isAlive(); });

  const ACTIVE_FRONT_INDEX = 1;                                     // party index used as the active battler
  const leaderId    = () => partyIdsAll()[ACTIVE_FRONT_INDEX] || 0;
  const leaderActor = () => $gameActors.actor(leaderId());
  const leaderIsDead = () => { const a = leaderActor(); return !a || a.isDead(); };
  const reservesAlive = () => {
    const ids = partyIdsAll();
    for (let i = ACTIVE_FRONT_INDEX + 1; i < ids.length; i++) {
      const a = $gameActors.actor(ids[i]);
      if (a && a.isAlive()) return true;
    }
    return false;
  };
  const inSwapScene = () => SceneManager._scene instanceof Scene_FonarySwitch;

  function refreshBattleUIAndReturnToInput() {
    setTimeout(() => {
      const scene = SceneManager._scene;
      if (scene && scene instanceof Scene_Battle) {
        if (scene.refreshStatus) scene.refreshStatus();
        if (scene._statusWindow) scene._statusWindow.refresh();
        if (scene._actorCommandWindow) scene._actorCommandWindow.refresh();
        BattleManager._phase = "input";
        if (!BattleManager.actor()) BattleManager.selectNextCommand();
        if (scene.startActorCommandSelection) scene.startActorCommandSelection();
      }
    }, 0);
  }
  function setSwapPending(v){ $gameTemp._fonarySwapPending = v; }
  function isSwapPending(){ return !!$gameTemp._fonarySwapPending; }
  function setSwapForced(v){ $gameTemp._fonarySwapForced = v; }
  function isSwapForced(){ return !!$gameTemp._fonarySwapForced; }

  // ------------------ Guard: don't start battle with 0 fonaries -------------
  const _SceneBattle_start = Scene_Battle.prototype.start;
  Scene_Battle.prototype.start = function() {
    if (nonTrainerCount() === 0) {
      // Player may be transparent due to encounter transition → force visible now
      if ($gamePlayer) { $gamePlayer.setTransparent(false); $gamePlayer.refresh(); }
      $gameMessage.add("You have no fonaries able to fight!");
      SceneManager.pop(); // back to map
      return;
    }
    _SceneBattle_start.call(this);
  };

  // Also make sure whenever we LEAVE the battle scene, the player is visible
  const _SceneBattle_terminate = Scene_Battle.prototype.terminate;
  Scene_Battle.prototype.terminate = function() {
    _SceneBattle_terminate.call(this);
    if ($gamePlayer) { $gamePlayer.setTransparent(false); $gamePlayer.refresh(); }
  };

  // ------------------ Trainer NEVER becomes a battler -----------------------
  const _GameParty_battleMembers = Game_Party.prototype.battleMembers;
  Game_Party.prototype.battleMembers = function() {
    // Build battle member list from party array, skipping trainer (index 0)
    const list = [];
    for (let i = 1; i < this._actors.length && list.length < this.maxBattleMembers(); i++) {
      const actor = $gameActors.actor(this._actors[i]);   // correct: fetch by actorId
      if (actor && actor.isAppeared()) list.push(actor);
    }
    return list;
  };

  // Defeat only when ALL non-trainer actors are dead.
  // If there are 0 fonaries, do NOT declare defeat (battle is blocked above).
  const _GameParty_isAllDead = Game_Party.prototype.isAllDead;
  Game_Party.prototype.isAllDead = function() {
    if (nonTrainerCount() === 0) return false;
    return !nonTrainerAlive();
  };

  // ------------------ Menu Status: hide trainer from list -------------------
  const _WindowMenuStatus_maxItems = Window_MenuStatus.prototype.maxItems;
  Window_MenuStatus.prototype.maxItems = function() {
    return Math.max(0, $gameParty._actors.length - 1);
  };
  const _WindowMenuStatus_drawItem = Window_MenuStatus.prototype.drawItem;
  Window_MenuStatus.prototype.drawItem = function(index) {
    const partyIndex = index + 1; // skip trainer
    const actorId = $gameParty._actors[partyIndex];
    const actor = actorId ? $gameActors.actor(actorId) : null;
    if (!actor) return;
    const rect = this.itemRectWithPadding(index);
    this.drawItemBackground(index);
    this.drawActorFace(actor, rect.x + 1, rect.y + 1, Window_Base._faceWidth, Window_Base._faceHeight);
    this.drawActorSimpleStatus(actor, rect.x + Window_Base._faceWidth + 8, rect.y, rect.width - Window_Base._faceWidth - 8);
  };

  // ------------------ Actor menu FIRST (skip party "Fight/Escape") ----------
  const _SceneBattle_startPartyCommandSelection = Scene_Battle.prototype.startPartyCommandSelection;
  Scene_Battle.prototype.startPartyCommandSelection = function() {
    if (!BattleManager.actor()) BattleManager.selectNextCommand();
    this.startActorCommandSelection();
  };

  // ------------------ Replace actor commands --------------------------------
  Window_ActorCommand.prototype.makeCommandList = function() {
    if (this._actor) {
      this.addCommand("Attack", "attack", true);
      this.addCommand("Items",  "item",   true);
      this.addCommand("Swap",   "fonarySwap", true);
      this.addCommand("Escape", "fonaryEscape", true);
    }
  };
  const _SceneBattle_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
  Scene_Battle.prototype.createActorCommandWindow = function() {
    _SceneBattle_createActorCommandWindow.call(this);
    const w = this._actorCommandWindow;
    w.setHandler("attack", this.commandAttack.bind(this));
    w.setHandler("item",   this.commandItem.bind(this));
    w.setHandler("fonarySwap", () => { if ($gameParty.inBattle()) SceneManager.push(Scene_FonarySwitch); });
    w.setHandler("fonaryEscape", () => { BattleManager.processEscape(); this._actorCommandWindow.deactivate(); });
  };

  // ------------------ Start messages only once ------------------------------
  let _startShown = false;
  const _BM_displayStartMessages = BattleManager.displayStartMessages;
  BattleManager.displayStartMessages = function() {
    if (_startShown) return;
    _startShown = true;
    _BM_displayStartMessages.call(this);
  };

  // ------------------ KO handling / force swap ------------------------------
  const _GBB_addNewState = Game_BattlerBase.prototype.addNewState;
  Game_BattlerBase.prototype.addNewState = function(stateId) {
    _GBB_addNewState.call(this, stateId);
    if ($gameParty.inBattle() && this.isActor && this.isActor() && stateId === this.deathStateId()) {
      if (this.actorId && this.actorId() !== trainerId()) $gameMessage.add(`${this.name()} is K.O.!`);
    }
    if (!$gameParty.inBattle() || !this.isActor || !this.isActor()) return;
    if (stateId !== this.deathStateId()) return;
    if (this.actorId && this.actorId() === leaderId()) {
      if (reservesAlive()) { setSwapForced(true); setSwapPending(true); }
    }
  };

  const _BM_update = BattleManager.update;
  BattleManager.update = function(timeActive) {
    if ($gameParty.inBattle()
      && leaderIsDead()
      && reservesAlive()
      && isSwapPending()
      && !inSwapScene()
      && !($gameMessage && $gameMessage.isBusy())) {
      this._subject = null; this._action = null; this._actionForcedBattler = null;
      this._phase = "input";
      SceneManager.push(Scene_FonarySwitch);
      return;
    }
    _BM_update.call(this, timeActive);
  };

  // ------------------ Swap menu (skip trainer; swap with index 1) -----------
  class Window_FonarySwitch extends Window_Command {
    initialize(rect){ super.initialize(rect); this.refresh(); this.select(0); this.activate(); }
    makeCommandList() {
      const ids = partyIdsAll();
      let any = false;
      for (let i = 1; i < ids.length; i++) {
        if (i === ACTIVE_FRONT_INDEX) continue;
        const a = $gameActors.actor(ids[i]);
        if (a && a.isAlive()) { any = true; this.addCommand(`${a.name()} — Lv ${a.level}`, "ok", true, i); }
      }
      if (!any) this.addCommand("(No available swaps)", "cancel", false, null);
    }
    maxCols(){ return 1; }
    currentExt(){ return this._list[this.index()] ? this._list[this.index()].ext : null; }
  }
  class Scene_FonarySwitch extends Scene_MenuBase {
    create(){
      super.create();
      const rows = Math.max(1, Math.min(8, Math.max(0, nonTrainerIds().length - 1)));
      const h = this.calcWindowHeight(rows, true);
      const rect = new Rectangle(0, (Graphics.boxHeight - h) / 2, Graphics.boxWidth, h);
      this._win = new Window_FonarySwitch(rect);
      this._win.setHandler("ok", this.onOk.bind(this));
      this._win.setHandler("cancel", this.onCancel.bind(this));
      this.addWindow(this._win);
      if (this._win.maxItems() === 0 || this._win.currentExt() === null) {
        $gameMessage.add("All the other fonaries are K.O.!");
        this.popScene(); setSwapPending(false); setSwapForced(false); refreshBattleUIAndReturnToInput();
      }
    }
    onOk(){ const partyIndex = this._win.currentExt(); if (partyIndex != null) $gameParty.swapOrder(partyIndex, ACTIVE_FRONT_INDEX); this.popScene(); setSwapPending(false); setSwapForced(false); refreshBattleUIAndReturnToInput(); }
    onCancel(){ if (isSwapForced()) { SoundManager.playBuzzer(); return; } this.popScene(); setSwapPending(false); refreshBattleUIAndReturnToInput(); }
  }
  window.Scene_FonarySwitch = Scene_FonarySwitch;

  // ------------------ Extra safety: whenever a map loads, ensure visible ----
  const _SceneMap_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function() {
    _SceneMap_start.call(this);
    if ($gamePlayer) { $gamePlayer.setTransparent(false); $gamePlayer.refresh(); }
  };

})();
