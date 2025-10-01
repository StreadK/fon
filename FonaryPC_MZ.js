/*:
 * @target MZ
 * @plugindesc Fonary PC (MZ): Deposit & Withdraw with trainer hidden. Party list shows only fonaries (skip slot 0). Team limit ignores trainer. Name + Lv with no overlap. Immediate HUD notices.
 * @help
 * Open via Plugin Command "Open Fonary PC"
 *   or Script: SceneManager.push(Scene_FonaryPC)
 *
 * Controls: Enter: Select / Esc: Back / Q/W: Change Box / Arrows: Move
 *
 * @param BoxCols
 * @text Box Columns
 * @type number
 * @min 3
 * @max 12
 * @default 5
 *
 * @command OpenFonaryPC
 * @text Open Fonary PC
 * @desc Open the PC storage scene.
 */

(() => {
  const PLUGIN = "FonaryPC_MZ";
  const P = PluginManager.parameters(PLUGIN);
  const BOX_COLS = Math.max(3, Number(P.BoxCols || 5));

  // Read params from boxes plugin
  const PB = PluginManager.parameters("FonaryBoxes_MZ") || {};
  const TEAM_LIMIT    = Number(PB.TeamLimit || 6); // number of FONARIES (trainer NOT counted)
  const BOX_SIZE      = Number(PB.BoxSize || 30);
  const INITIAL_BOXES = Number(PB.InitialBoxes || 8);
  const AUTO_GROW     = String(PB.AutoGrowBoxes || "true") === "true";

  PluginManager.registerCommand(PLUGIN, "OpenFonaryPC", () => SceneManager.push(Scene_FonaryPC));

  // ---- Storage helpers ----
  function ensureBoxes() {
    const sys = $gameSystem;
    if (!sys._fonaryBoxes) {
      sys._fonaryBoxes = [];
      for (let i = 0; i < INITIAL_BOXES; i++) sys._fonaryBoxes.push(Array(BOX_SIZE).fill(0));
    }
    if ($gameSystem._fonaryBoxes.length === 0) $gameSystem._fonaryBoxes.push(Array(BOX_SIZE).fill(0));
  }
  function boxes() { ensureBoxes(); return $gameSystem._fonaryBoxes; }
  function addEmptyBox() { $gameSystem._fonaryBoxes.push(Array(BOX_SIZE).fill(0)); }
  function firstFreeSlotIn(boxIndex) {
    const arr = boxes()[boxIndex];
    const idx = arr.indexOf(0);
    if (idx >= 0) return idx;
    if (AUTO_GROW) { addEmptyBox(); return 0; }
    return -1;
  }

  // ---- Party helpers (TRAINER AWARE) ----
  const partyIdsAll = () => $gameParty._actors.slice();   // raw party array
  const trainerId   = () => (partyIdsAll()[0] || 0);
  const nonTrainerPartyIds = () => partyIdsAll().slice(1); // skip trainer
  const teamSizeNonTrainer = () => nonTrainerPartyIds().length;

  // ---- Shared draw helper: Name left, Lv right (ellipsis if needed) ----
  function drawNameAndLevel(win, rect, name, level) {
    const pad = 6;
    const lvlText = `Lv ${level}`;
    const lvlW = Math.ceil(win.textWidth(lvlText)) + pad;
    win.drawText(lvlText, rect.x, rect.y, rect.width, "right");
    const avail = Math.max(0, rect.width - lvlW);
    let show = name;
    if (win.textWidth(show) > avail) {
      const ell = "…"; const ellW = win.textWidth(ell);
      let s = show;
      while (s.length > 1 && win.textWidth(s) + ellW > avail) s = s.slice(0, -1);
      show = s + (s !== name ? ell : "");
    }
    win.drawText(show, rect.x, rect.y, avail, "left");
  }

  // ---- Windows ----
  class Window_FonaryHelp extends Window_Base {
    initialize(rect){ super.initialize(rect); this._hint=""; this.refresh(); }
    setHint(t){ this._hint=t||""; this.refresh(); }
    refresh(){
      this.createContents();
      this.contents.clear();
      const t = this._hint || "Enter: Select   Esc: Back   Q/W: Change Box   ←↑→↓: Move";
      this.drawText(t, 0, 0, this.contents.width, "center");
    }
  }

  // PARTY window that HIDES the trainer (slot 0)
  class Window_FonaryParty extends Window_Selectable {
    initialize(rect){ super.initialize(rect); this.refresh(); }
    list(){ return nonTrainerPartyIds(); }
    maxItems(){ return this.list().length; }
    drawItem(index){
      const rect = this.itemRectWithPadding(index);
      const actorId = this.list()[index];
      const a = $gameActors.actor(actorId);
      if (!a) return;
      this.resetTextColor();
      drawNameAndLevel(this, rect, a.name(), a.level);
    }
    currentActorId(){ const i=this.index(); return i>=0? this.list()[i]:0; }
  }

  class Window_FonaryBox extends Window_Selectable {
    initialize(rect){
      super.initialize(rect);
      this._boxIndex = 0;
      this._cols = BOX_COLS;
      this._labelH = this.lineHeight();
      this.refresh();
      this.activate();
    }
    setBoxIndex(i){ this._boxIndex=i; this.refresh(); }
    boxIndex(){ return this._boxIndex; }
    maxCols(){ return this._cols; }
    maxItems(){ return BOX_SIZE; }

    itemHeight(){
      const rows = Math.ceil(BOX_SIZE / this.maxCols());
      return Math.max(1, Math.floor((this.innerHeight - this._labelH) / rows));
    }
    itemRect(index){
      const rect = new Rectangle(0,0,0,0);
      const cols = this.maxCols();
      const iw = Math.floor(this.innerWidth / cols);
      const ih = this.itemHeight();
      const col = index % cols;
      const row = Math.floor(index / cols);
      rect.x = col * iw;
      rect.y = this._labelH + row * ih;
      rect.width = iw;
      rect.height = ih;
      return rect;
    }

    processHandling(){
      super.processHandling();
      if (this.isOpenAndActive()){
        if (Input.isTriggered("pageup"))  this.prevBox();
        if (Input.isTriggered("pagedown")) this.nextBox();
      }
    }
    nextBox(){ const b=boxes(); this._boxIndex=(this._boxIndex+1)%b.length; this.refresh(); SoundManager.playCursor(); }
    prevBox(){ const b=boxes(); this._boxIndex=(this._boxIndex-1+b.length)%b.length; this.refresh(); SoundManager.playCursor(); }

    refresh(){
      this.createContents();
      this.contents.clear();
      const b = boxes();
      const label = `Box ${this._boxIndex + 1}/${b.length}  (Q/W to change)`;
      this.drawText(label, 0, 0, this.contents.width, "center");
      for (let i=0;i<this.maxItems();i++) this.drawItem(i);
    }

    drawItem(index){
      const raw = this.itemRect(index);
      const pad = this.itemPadding();
      const rect = new Rectangle(raw.x + pad, raw.y + pad, raw.width - pad*2, raw.height - pad*2);
      const arr = boxes()[this._boxIndex];
      const actorId = arr[index] || 0;
      this.resetTextColor();
      if (actorId === 0){
        this.changePaintOpacity(false);
        this.drawText("[empty]", rect.x, rect.y, rect.width, "center");
        this.changePaintOpacity(true);
        return;
      }
      const a = $gameActors.actor(actorId);
      drawNameAndLevel(this, rect, a.name(), a.level);
    }

    currentSlotIndex(){ return this.index(); }
    currentActorId(){
      const i = this.index();
      const arr = boxes()[this._boxIndex];
      return (i>=0 && arr)? (arr[i]||0) : 0;
    }
    takeAt(slotIndex){
      const arr = boxes()[this._boxIndex];
      const id = arr[slotIndex] || 0;
      if (id) arr[slotIndex] = 0;
      this.refresh();
      return id;
    }
    putAt(slotIndex, actorId){
      const arr = boxes()[this._boxIndex];
      if (arr[slotIndex] && arr[slotIndex] !== 0) return false;
      arr[slotIndex] = actorId;
      this.refresh();
      return true;
    }
    putActorIdFirstFree(actorId){
      const pos = firstFreeSlotIn(this._boxIndex);
      if (pos < 0) return false;
      boxes()[this._boxIndex][pos] = actorId;
      this.refresh();
      return true;
    }
  }

  // ---- Scene ----
  class Scene_FonaryPC extends Scene_MenuBase {
    create(){
      super.create();
      ensureBoxes();

      const ww = Graphics.boxWidth, wh = Graphics.boxHeight;
      const helpH  = this.calcWindowHeight(1, true);
      const partyH = this.calcWindowHeight(6, true);
      const boxH   = wh - helpH - partyH;

      const helpRect  = new Rectangle(0, 0, ww, helpH);
      const partyRect = new Rectangle(0, wh - partyH, ww, partyH);
      const boxRect   = new Rectangle(0, helpH, ww, boxH);

      this._help  = new Window_FonaryHelp(helpRect);
      this._party = new Window_FonaryParty(partyRect); // trainer already hidden
      this._box   = new Window_FonaryBox(boxRect);

      this.addWindow(this._help);
      this.addWindow(this._party);
      this.addWindow(this._box);

      this._mode = "browse";       // "browse" | "depositPicking"
      this._depositTarget = null;  // {box, slot}
      this._noticeTimer = null;

      this._party.setHandler("ok", this.onPartyOk.bind(this));
      this._party.setHandler("cancel", this.onPartyCancel.bind(this));
      this._box.setHandler("ok", this.onBoxOk.bind(this));
      this._box.setHandler("cancel", this.popScene.bind(this));

      this._help.setHint("Enter: Select   Esc: Back   Q/W: Change Box   ←↑→↓: Move");
      this._box.activate(); this._box.select(0);
      this._party.deactivate(); this._party.select(0);
    }

    // Immediate notice in the top bar
    notice(msg, sound="buzzer"){
      if (sound === "buzzer") SoundManager.playBuzzer(); else SoundManager.playOk();
      if (this._noticeTimer) clearTimeout(this._noticeTimer);
      this._help.setHint(msg);
      this._noticeTimer = setTimeout(() => {
        if (this._help) this._help.setHint("Enter: Select   Esc: Back   Q/W: Change Box   ←↑→↓: Move");
      }, 1200);
    }

    // Withdraw / Deposit-from-empty-slot
    onBoxOk(){
      const slot = this._box.currentSlotIndex();
      const id   = this._box.currentActorId();

      if (id) { // OCCUPIED → Withdraw
        if (teamSizeNonTrainer() >= TEAM_LIMIT) { this.notice("Your team is full!"); return this.reactivateBox(); }
        const taken = this._box.takeAt(slot);
        if (taken) { $gameParty.addActor(taken); SoundManager.playOk(); this._party.refresh(); this._box.refresh(); }
        else SoundManager.playBuzzer();
        return this.reactivateBox();
      }

      // EMPTY → choose a fonary to put in this slot
      if (teamSizeNonTrainer() <= 1) { this.notice("You must keep at least one fonary in your team."); return this.reactivateBox(); }

      this._mode = "depositPicking";
      this._depositTarget = { box: this._box.boxIndex(), slot: slot };
      this._help.setHint("Choose a fonary to store in this slot (Esc to cancel).");
      this._box.deactivate();
      this._party.activate();
      this._party.select(Math.max(0, this._party.index()));
      SoundManager.playCursor();
    }

    // Party OK (deposit)
    onPartyOk(){
      const actorId = this._party.currentActorId(); // already excludes trainer
      if (!actorId) { SoundManager.playBuzzer(); return this.reactivateParty(); }

      if (teamSizeNonTrainer() <= 1) { this.notice("You must keep at least one fonary in your team."); return this.reactivateParty(); }

      if (this._mode === "depositPicking" && this._depositTarget){
        const { box, slot } = this._depositTarget;
        if (boxes()[box][slot] !== 0) { this.notice("That slot is no longer empty."); this._mode="browse"; this._depositTarget=null; this.backToBox(); return; }
        boxes()[box][slot] = actorId;   // put into chosen slot
      } else {
        const ok = this._box.putActorIdFirstFree(actorId);
        if (!ok) { this.notice("No space in this box."); return this.reactivateParty(); }
      }

      $gameParty.removeActor(actorId);
      SoundManager.playOk();
      this._party.refresh();
      this._box.refresh();

      this._mode = "browse";
      this._depositTarget = null;
      this._help.setHint("Enter: Select   Esc: Back   Q/W: Change Box   ←↑→↓: Move");
      this.backToBox();
    }

    onPartyCancel(){
      if (this._mode === "depositPicking"){
        this._mode = "browse";
        this._depositTarget = null;
        this._help.setHint("Enter: Select   Esc: Back   Q/W: Change Box   ←↑→↓: Move");
        this.backToBox();
      } else {
        this.popScene();
      }
    }

    // Focus helpers
    reactivateBox(){ this._party.deactivate(); this._box.activate(); }
    reactivateParty(){ this._box.deactivate(); this._party.activate(); }
    backToBox(){ this._party.deactivate(); this._box.activate(); this._box.select(Math.max(0, this._box.index())); }
  }

  window.Scene_FonaryPC = Scene_FonaryPC;
})();
