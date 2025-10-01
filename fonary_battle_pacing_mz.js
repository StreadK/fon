/*:
 * @target MZ
 * @plugindesc Fonary Battle Pacing: action text first (bottom), then animation & damage; clear waits so turns don't overlap. Non-destructive, KO/EXP flow untouched.
 * @author You
 * @help
 * Put this plugin LAST (below HUD/flow/learn plugins).
 * It routes the "X uses Y!" line to the bottom message window and
 * forces the engine to wait for that message before running the animation & damage.
 *
 * @param PreAnimWait
 * @text Extra wait after action text (frames)
 * @type number
 * @min 0
 * @max 240
 * @default 12
 *
 * @param PostResultWait
 * @text Wait after damage/results (frames)
 * @type number
 * @min 0
 * @max 240
 * @default 18
 *
 * @param MissEvadeExtraWait
 * @text Extra wait on miss/evade (frames)
 * @type number
 * @min 0
 * @max 240
 * @default 10
 */

(() => {
  "use strict";

  const PN = "fonary_battle_pacing_mz";
  const P  = PluginManager.parameters(PN);

  const PRE_ANIM_WAIT      = Math.max(0, Number(P.PreAnimWait || 12));
  const POST_RESULT_WAIT   = Math.max(0, Number(P.PostResultWait || 18));
  const MISS_EVADE_EXTRA   = Math.max(0, Number(P.MissEvadeExtraWait || 10));

  // --- Utility: unified wait on the battle log queue ---
  function pushWait(logWindow, frames) {
    if (frames <= 0) return;
    // Emulate N frames by pushing 'wait' multiple times (engine uses messageSpeed per 'wait')
    // We implement an inline wait method that uses a fixed frame count so it's precise.
    logWindow.push("fonWaitFixed", frames);
  }

  // Extend the battle log with a precise fixed wait
  Window_BattleLog.prototype.fonWaitFixed = function(frames) {
    this._fonWaitFixed = Math.max(this._fonWaitFixed || 0, frames|0);
  };
  const _WBL_update = Window_BattleLog.prototype.update;
  Window_BattleLog.prototype.update = function() {
    if ((this._fonWaitFixed||0) > 0) {
      this._fonWaitFixed--;
      return;
    }
    _WBL_update.call(this);
  };

  // Add a custom wait mode that blocks until the bottom message window is done
  Window_BattleLog.prototype.waitForBottomMessage = function() {
    this.setWaitMode("bottomMessage");
  };
  const _WBL_updateWaitMode = Window_BattleLog.prototype.updateWaitMode;
  Window_BattleLog.prototype.updateWaitMode = function() {
    if (this._waitMode === "bottomMessage") {
      const busy = !!($gameMessage && $gameMessage.isBusy && $gameMessage.isBusy());
      if (busy) return true;
      this._waitMode = "";
      return false;
    }
    return _WBL_updateWaitMode.call(this);
  };

  // Build the "X uses Y!" line (fallback if engine text not available)
  function buildActionText(subject, item) {
    const sName = subject && subject.name ? subject.name() : "???";
    const iName = item && item.name ? item.name : "???";
    return `${sName} uses ${iName}!`;
  }

  // --- Show the action line in the bottom message window, then wait ---
  const _displayActionLine = Window_BattleLog.prototype.displayActionLine;
  Window_BattleLog.prototype.displayActionLine = function(subject, item) {
    // Show the action text on your bottom message window
    try {
      const text = (this.makeActionText ? this.makeActionText(subject, item) : buildActionText(subject, item)) || buildActionText(subject, item);
      if ($gameMessage && $gameMessage.add) {
        $gameMessage.add(text);
        // Wait until the player lets it advance (or auto-advance finishes)
        this.push("waitForBottomMessage");
        // A small extra padding before animation starts
        pushWait(this, PRE_ANIM_WAIT);
        return; // IMPORTANT: do not also push the engine's own text line to avoid duplicates
      }
    } catch (e) {
      console.warn("fonary_battle_pacing: displayActionLine fallback", e);
    }
    // Fallback to original if bottom message not available
    _displayActionLine.call(this, subject, item);
    pushWait(this, PRE_ANIM_WAIT);
  };

  // --- After results have been shown (damage popups/HP), add a small wait ---
  const _displayActionResults = Window_BattleLog.prototype.displayActionResults;
  Window_BattleLog.prototype.displayActionResults = function(subject, item) {
    _displayActionResults.call(this, subject, item);
    pushWait(this, POST_RESULT_WAIT);
  };

  // --- Make misses/evades linger a touch longer so they're readable ---
  const _displayMiss = Window_BattleLog.prototype.displayMiss;
  Window_BattleLog.prototype.displayMiss = function(target) {
    _displayMiss.call(this, target);
    pushWait(this, MISS_EVADE_EXTRA);
  };
  const _displayEvasion = Window_BattleLog.prototype.displayEvasion;
  Window_BattleLog.prototype.displayEvasion = function(target) {
    _displayEvasion.call(this, target);
    pushWait(this, MISS_EVADE_EXTRA);
  };

})();
