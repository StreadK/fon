/*:
 * @target MZ
 * @plugindesc Battle messages: single bottom Message Window, topmost; hide Battle Log; ADD configurable waits/sleeps between all battle texts/events.
 * @author You
 * @help
 * - All "X used Y!", damage, EXP, etc. go to the bottom Message Window.
 * - Battle Log window stays hidden.
 * - Message Window is kept on top (highest z).
 * - NEW: Adds waits so actions don’t feel simultaneous.
 *
 * Place BELOW your HUD/sprites/trainer plugins.
 *
 * @param DropWhenBusy
 * @text Drop Lines While Message Showing
 * @type boolean
 * @default true
 * @desc If true, new battle lines are skipped while a message is open. If false, they still route to the same box.
 *
 * @param ForceTopmost
 * @text Keep Message Window On Top
 * @type boolean
 * @default true
 *
 * @param ForceBottom
 * @text Force Message Position Bottom
 * @type boolean
 * @default true
 *
 * @param WaitPerText
 * @text Wait per Battle Text (frames)
 * @type number
 * @min 1
 * @default 30
 * @desc ~60 frames = 1 second. This delay is applied each time battle text is added.
 *
 * @param ExtraWaitOnWaitCalls
 * @text Extra Wait for Log wait() calls (frames)
 * @type number
 * @min 0
 * @default 20
 * @desc Some engine sequences call log.wait(); we convert those into this extra delay.
 */

(() => {
  const PN = "fonary_battle_messages_bottom_unified_mz";
  const P  = PluginManager.parameters(PN);
  const DROP_WHEN_BUSY = String(P.DropWhenBusy || "true") === "true";
  const FORCE_TOPMOST  = String(P.ForceTopmost || "true") === "true";
  const FORCE_BOTTOM   = String(P.ForceBottom  || "true") === "true";
  const WAIT_PER_TEXT  = Math.max(1, Number(P.WaitPerText || 30));
  const EXTRA_WAIT     = Math.max(0, Number(P.ExtraWaitOnWaitCalls || 20));

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function sceneBattle() {
    const s = SceneManager._scene;
    return s instanceof Scene_Battle ? s : null;
  }
  function messageWindow() {
    const s = sceneBattle();
    return s ? s._messageWindow : null;
  }
  function isMsgBusy() {
    if ($gameMessage.isBusy && $gameMessage.isBusy()) return true;
    const w = messageWindow();
    if (!w) return false;
    return w.isOpen() || w.isOpening() || w.isClosing();
  }
  function pushToMessage(text) {
    if (FORCE_BOTTOM && $gameMessage.setPositionType) $gameMessage.setPositionType(2); // bottom
    $gameMessage.add(String(text));
  }
  function bringMessageToFront() {
    if (!FORCE_TOPMOST) return;
    const s = sceneBattle();
    if (!s || !s._windowLayer) return;
    const w = s._messageWindow;
    if (!w) return;
    const layer = s._windowLayer;
    if (layer.children[layer.children.length - 1] !== w) {
      layer.removeChild(w);
      layer.addChild(w);
    }
  }

  // --------------------------------------------------------------------------
  // Create/maintain bottom message window on top
  // --------------------------------------------------------------------------
  const _SB_createMessageWindow = Scene_Battle.prototype.createMessageWindow;
  Scene_Battle.prototype.createMessageWindow = function () {
    _SB_createMessageWindow.call(this);
    if (FORCE_BOTTOM && $gameMessage.setPositionType) {
      $gameMessage.setPositionType(2);
      if (this._messageWindow?.updatePlacement) this._messageWindow.updatePlacement();
    }
    bringMessageToFront();
  };
  const _SB_update = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function () {
    _SB_update.call(this);
    bringMessageToFront();
  };

  // --------------------------------------------------------------------------
  // Hide the real Battle Log window (we still use it as a "wait gate")
  // --------------------------------------------------------------------------
  const _SB_createLogWindow = Scene_Battle.prototype.createLogWindow;
  Scene_Battle.prototype.createLogWindow = function () {
    _SB_createLogWindow.call(this);
    const w = this._logWindow;
    if (w) {
      w.visible = false;
      w.opacity = 0;
      w.height  = 0;
      w.y       = Graphics.boxHeight + 200; // off-screen
      w.setBackgroundType?.(2);
      w.clear?.();
      w._fonForcedWait = 0; // our custom wait counter
    }
  };

  // Initialize custom wait counter if needed
  const _WBL_initialize = Window_BattleLog.prototype.initialize;
  Window_BattleLog.prototype.initialize = function (rect) {
    _WBL_initialize.call(this, rect);
    this._fonForcedWait = 0;
  };

  // Tick down our wait each frame
  const _WBL_update = Window_BattleLog.prototype.update;
  Window_BattleLog.prototype.update = function () {
    _WBL_update.call(this);
    if (this._fonForcedWait > 0) this._fonForcedWait--;
  };

  Window_BattleLog.prototype.fonStartWait = function (frames) {
    this._fonForcedWait = Math.max(this._fonForcedWait || 0, frames|0);
  };

  // The engine checks log.isBusy() to decide if it can continue.
  // We hook that to respect our waits and the message window state.
  Window_BattleLog.prototype.isBusy = function () {
    return (this._fonForcedWait > 0) || isMsgBusy();
  };

  // Convert any engine "wait()" calls into a small pause
  Window_BattleLog.prototype.wait = function () {
    if (EXTRA_WAIT > 0) this.fonStartWait(EXTRA_WAIT);
  };
  Window_BattleLog.prototype.waitForNewLine = function () {
    if (EXTRA_WAIT > 0) this.fonStartWait(EXTRA_WAIT);
    return true;
  };
  Window_BattleLog.prototype.updateWait = function () {
    // Use our own counter; returning true tells the log it's still waiting.
    return this._fonForcedWait > 0;
  };
  Window_BattleLog.prototype.updateWaitCount = function () {
    return this._fonForcedWait > 0;
  };

  // Route all log text to the Message Window AND add a per-text wait
  Window_BattleLog.prototype.addText = function (text) {
    if (!DROP_WHEN_BUSY || !isMsgBusy()) {
      pushToMessage(text);
      this.fonStartWait(WAIT_PER_TEXT);
    }
    // Do not call the original addText.
  };

  // Neutralize visuals for the hidden log
  Window_BattleLog.prototype.open = function () {};
  Window_BattleLog.prototype.show = function () {};
  Window_BattleLog.prototype.refresh = function () {};
  Window_BattleLog.prototype.clear = function () {
    if (this._lines) this._lines.length = 0;
  };
})();
