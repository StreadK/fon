/*:
 * @target MZ
 * @plugindesc Fonary Boxes (PC) for Pokémon-like games: team limit, deposit/withdraw UI, auto-send captured to box if full.
 * @help
 * HOW TO USE
 * ----------
 * 1) Set TeamLimit (default 6), BoxSize (default 30), InitialBoxes (default 8).
 * 2) To open the PC UI from an event, use the plugin command:
 *      OpenFonaryPC
 *    (You can make a PC event on the map that runs this.)
 *
 * 3) After you create a new captured actor (a shell you "stamped"), call:
 *      Plugin Command: AddCapturedActor actorId: <ID or use VAR below>
 *    OR from a Script call in your Common Event / plugin:
 *      FonaryBoxes.addCaptured(<actorId>)
 *    It will add to party if space, else send to the box and show a message.
 *
 * 4) You can also call:
 *      Plugin Command: AddCapturedActorFromVar varId: <variable number holding actorId>
 *
 * NOTES
 * -----
 * - Boxes are persisted in saves via $gameSystem._fonaryBoxes (array of boxes; each box is an array of actorIds or 0 for empty).
 * - Duplicate species are fully supported because each capture occupies a distinct actorId (your shell system).
 *
 * @param TeamLimit
 * @text Team Size Limit
 * @type number
 * @min 1
 * @default 6
 *
 * @param BoxSize
 * @text Slots Per Box
 * @type number
 * @min 1
 * @default 30
 *
 * @param InitialBoxes
 * @text Initial Box Count
 * @type number
 * @min 1
 * @default 8
 *
 * @param AutoGrowBoxes
 * @text Auto-Grow Boxes When Full
 * @type boolean
 * @on Yes
 * @off No
 * @default true
 *
 * @param MsgSentToBox
 * @text Message: Sent To Box
 * @type string
 * @default \\n<PC> was sent to the Box!
 *
 * @param MsgPartyFull
 * @text Message: Party Full
 * @type string
 * @default Your team is full!
 *
 * @param MsgWithdraw
 * @text Message: Withdraw
 * @type string
 * @default Withdrew \\n<PC>.
 *
 * @param MsgDeposit
 * @text Message: Deposit
 * @type string
 * @default Deposited \\n<PC>.
 *
 * @param UILabelParty
 * @text UI Label: Party
 * @type string
 * @default Team
 *
 * @param UILabelBox
 * @text UI Label: Box
 * @type string
 * @default Box %1
 *
 * @param UILastBoxTip
 * @text UI Tip: Last Box Full
 * @type string
 * @default All boxes are full.
 *
 * @command OpenFonaryPC
 * @text Open Fonary PC
 * @desc Open the Box UI (deposit/withdraw).
 *
 * @command AddCapturedActor
 * @text Add Captured Actor (ID)
 * @desc Add a newly-captured actorId to party or box.
 * @arg actorId
 * @type actor
 * @default 0
 *
 * @command AddCapturedActorFromVar
 * @text Add Captured Actor (from Variable)
 * @desc Add a newly-captured actorId stored in a variable.
 * @arg varId
 * @type variable
 * @default 0
 */

(() => {
  const PN = "FonaryBoxes_MZ";
  const P = PluginManager.parameters(PN);

  const TEAM_LIMIT   = Number(P.TeamLimit || 6);
  const BOX_SIZE     = Number(P.BoxSize || 30);
  const INITIAL_BOXES= Number(P.InitialBoxes || 8);
  const AUTO_GROW    = String(P.AutoGrowBoxes || "true") === "true";

  const MSG_SENT     = String(P.MsgSentToBox || "\\n<PC> was sent to the Box!");
  const MSG_FULL     = String(P.MsgPartyFull || "Your team is full!");
  const MSG_WD       = String(P.MsgWithdraw || "Withdrew \\n<PC>.");
  const MSG_DP       = String(P.MsgDeposit || "Deposited \\n<PC>.");

  const UI_PARTY     = String(P.UILabelParty || "Team");
  const UI_BOXLBL    = String(P.UILabelBox || "Box %1");
  const UI_LASTTIP   = String(P.UILastBoxTip || "All boxes are full.");

  // ----------------------------------------------------------------------------
  // Data store & helpers
  // ----------------------------------------------------------------------------
  function ensureBoxes() {
    const sys = $gameSystem;
    if (!sys._fonaryBoxes) {
      sys._fonaryBoxes = [];
      for (let i = 0; i < INITIAL_BOXES; i++) sys._fonaryBoxes.push(newBox());
    }
    if (sys._fonaryBoxes.length === 0) {
      sys._fonaryBoxes.push(newBox());
    }
  }
  function newBox() {
    const arr = [];
    for (let i = 0; i < BOX_SIZE; i++) arr.push(0); // 0 = empty slot
    return arr;
  }
  function boxes() {
    ensureBoxes();
    return $gameSystem._fonaryBoxes;
  }
  function firstFreeSlot() {
    ensureBoxes();
    for (let b = 0; b < boxes().length; b++) {
      const box = boxes()[b];
      const s = box.indexOf(0);
      if (s >= 0) return { box: b, slot: s };
    }
    if (AUTO_GROW) {
      boxes().push(newBox());
      return { box: boxes().length - 1, slot: 0 };
    }
    return null;
  }
  function putInBox(actorId) {
    const pos = firstFreeSlot();
    if (!pos) return null;
    boxes()[pos.box][pos.slot] = actorId;
    return pos;
  }
  function removeFromBox(boxIndex, slotIndex) {
    const id = boxes()[boxIndex][slotIndex];
    boxes()[boxIndex][slotIndex] = 0;
    return id;
  }
  function partyIsFull() {
    return $gameParty.members().length >= TEAM_LIMIT;
  }
  function actorNameById(id) {
    const a = $gameActors.actor(id);
    return a ? a.name() : "Unknown";
  }

  // Public API for other events/plugins
  window.FonaryBoxes = {
    addCaptured(actorId) {
      if (!actorId) return false;
      const name = actorNameById(actorId);
      if (!partyIsFull()) {
        $gameParty.addActor(actorId);
        return true;
      } else {
        const pos = putInBox(actorId);
        if (!pos) {
          $gameMessage.add(UI_LASTTIP);
          return false;
        }
        // Message with \n<PC> = captured name
        $gameMessage.add(MSG_SENT.replace("\\n<PC>", name));
        return true;
      }
    }
  };

  // Plugin commands
  PluginManager.registerCommand(PN, "OpenFonaryPC", () => {
    SceneManager.push(Scene_FonaryPC);
  });
  PluginManager.registerCommand(PN, "AddCapturedActor", args => {
    const id = Number(args.actorId || 0);
    if (id > 0) FonaryBoxes.addCaptured(id);
  });
  PluginManager.registerCommand(PN, "AddCapturedActorFromVar", args => {
    const vId = Number(args.varId || 0);
    const id = $gameVariables.value(vId);
    if (id > 0) FonaryBoxes.addCaptured(id);
  });

  // ----------------------------------------------------------------------------
  // PC UI
  // ----------------------------------------------------------------------------
  class Window_FonaryParty extends Window_Selectable {
    initialize(rect) { super.initialize(rect); this.refresh(); }
    maxItems() { return $gameParty.members().length; }
    itemAt(i) { return $gameParty.members()[i]; }
    drawItem(i) {
      const rect = this.itemLineRect(i);
      const a = this.itemAt(i);
      if (!a) return;
      // Name — Lv — HP%
      const hpPct = Math.round(a.hpRate() * 100);
      const left = `${a.name()} — Lv ${a.level} — `;
      this.changeTextColor(ColorManager.normalColor());
      this.drawText(left, rect.x, rect.y, rect.width, "left");
      let hpColor;
      if (hpPct >= 50) hpColor = ColorManager.hpGaugeColor1();
      else if (hpPct >= 20) hpColor = ColorManager.crisisColor();
      else hpColor = ColorManager.knockoutColor();
      this.changeTextColor(hpColor);
      this.drawText(`${hpPct}% HP`, rect.x, rect.y, rect.width, "right");
      this.changeTextColor(ColorManager.normalColor());
    }
    currentActorId() { const a = this.itemAt(this.index()); return a ? a.actorId() : 0; }
  }

  class Window_FonaryBox extends Window_Selectable {
    initialize(rect) { super.initialize(rect); this._boxIndex = 0; ensureBoxes(); this.refresh(); }
    setBox(i){ this._boxIndex = i; this.refresh(); }
    maxCols() { return 5; }
    maxItems() { return BOX_SIZE; }
    drawItem(i) {
      const rect = this.itemRect(i);
      const id = boxes()[this._boxIndex][i];
      this.changePaintOpacity(true);
      this.drawRectSlot(rect, id);
    }
    drawRectSlot(rect, actorId) {
      // simple framed slot
      this.contents.paintOpacity = 255;
      this.drawText("", rect.x, rect.y, rect.width);
      this.contentsOut.clearRect(rect.x, rect.y, rect.width, rect.height);
      this.changeTextColor(ColorManager.normalColor());
      if (actorId) {
        const a = $gameActors.actor(actorId);
        const name = a ? a.name() : "???";
        this.drawText(name, rect.x+4, rect.y, rect.width-8, "left");
      } else {
        this.changePaintOpacity(false);
        this.drawText("(empty)", rect.x+4, rect.y, rect.width-8, "left");
        this.changePaintOpacity(true);
      }
    }
    currentActorId(){ return boxes()[this._boxIndex][this.index()] || 0; }
    boxIndex(){ return this._boxIndex; }
  }

  class Window_FonaryBoxHeader extends Window_Base {
    initialize(rect){ super.initialize(rect); this._boxIndex = 0; this.refresh(); }
    setBox(i){ this._boxIndex = i; this.refresh(); }
    refresh(){
      this.contents.clear();
      const txt = UI_BOXLBL.replace("%1", (this._boxIndex+1));
      this.drawText(txt, 0, 0, this.contents.width, "center");
    }
    boxIndex(){ return this._boxIndex; }
  }

  class Scene_FonaryPC extends Scene_MenuBase {
    create() {
      super.create();
      ensureBoxes();

      const margin = 6;
      const ww = Graphics.boxWidth;
      const wh = Graphics.boxHeight;

      // Party window (top)
      const partyH = this.calcWindowHeight(6, true);
      const partyRect = new Rectangle(0, 0, ww, partyH);
      this._partyWin = new Window_FonaryParty(partyRect);
      this._partyWin.setHandler("ok",     this.onDeposit.bind(this));
      this._partyWin.setHandler("cancel", this.onCancelParty.bind(this));
      this.addWindow(this._partyWin);

      // Box header (middle small)
      const headRect = new Rectangle(0, partyH, ww, this.calcWindowHeight(1, true));
      this._boxHeader = new Window_FonaryBoxHeader(headRect);
      this.addWindow(this._boxHeader);

      // Box window (bottom)
      const boxRect = new Rectangle(0, partyH + headRect.height, ww, wh - (partyH + headRect.height) - this.calcWindowHeight(1, true));
      this._boxWin = new Window_FonaryBox(boxRect);
      this._boxWin.setHandler("ok",     this.onWithdraw.bind(this));
      this._boxWin.setHandler("cancel", this.onCancelBox.bind(this));
      this.addWindow(this._boxWin);

      // Footer/help
      const helpRect = new Rectangle(0, wh - this.calcWindowHeight(1, true), ww, this.calcWindowHeight(1, true));
      this._help = new Window_Help(1);
      this._help.move(helpRect.x, helpRect.y, helpRect.width, helpRect.height);
      this._help.setText(`${UI_PARTY}: OK=Deposit  |  ${UI_BOXLBL.replace("%1", this._boxWin.boxIndex()+1)}: OK=Withdraw  |  L/R=Change Box`);
      this.addWindow(this._help);

      this._partyWin.activate();
      this._partyWin.select(0);
    }

    // L/R change box
    update() {
      super.update();
      if (Input.isTriggered("pageup"))  this.changeBox(-1);
      if (Input.isTriggered("pagedown")) this.changeBox(+1);
      if (TouchInput.wheelY < 0) this.changeBox(-1);
      if (TouchInput.wheelY > 0) this.changeBox(+1);
    }

    changeBox(delta) {
      let idx = this._boxWin.boxIndex() + delta;
      if (idx < 0) idx = boxes().length - 1;
      if (idx >= boxes().length) {
        if (AUTO_GROW) { boxes().push(newBox()); idx = boxes().length - 1; }
        else idx = 0;
      }
      this._boxWin.setBox(idx);
      this._boxHeader.setBox(idx);
      this._help.setText(`${UI_PARTY}: OK=Deposit  |  ${UI_BOXLBL.replace("%1", idx+1)}: OK=Withdraw  |  L/R=Change Box`);
    }

    onDeposit() {
      const a = this._partyWin.itemAt(this._partyWin.index());
      if (!a) { this._partyWin.activate(); return; }
      if ($gameParty.members().length <= 1) {
        SoundManager.playBuzzer();
        return;
      }
      const pos = firstFreeSlot();
      if (!pos) { $gameMessage.add(UI_LASTTIP); return; }
      boxes()[pos.box][pos.slot] = a.actorId();
      $gameParty.removeActor(a.actorId());
      $gameMessage.add(MSG_DP.replace("\\n<PC>", a.name()));
      this._partyWin.refresh();
      this._boxWin.refresh();
    }
    onWithdraw() {
      const id = this._boxWin.currentActorId();
      if (!id) { this._boxWin.activate(); return; }
      if (partyIsFull()) { $gameMessage.add(MSG_FULL); return; }
      const name = actorNameById(id);
      // Remove from box, add to party
      boxes()[this._boxWin.boxIndex()][this._boxWin.index()] = 0;
      $gameParty.addActor(id);
      $gameMessage.add(MSG_WD.replace("\\n<PC>", name));
      this._partyWin.refresh();
      this._boxWin.refresh();
    }
    onCancelParty(){ this._boxWin.activate(); this._boxWin.select(0); }
    onCancelBox(){ this._partyWin.activate(); }
  }

  // Make the class globally available (not strictly necessary, but handy)
  window.Scene_FonaryPC = Scene_FonaryPC;

})();
