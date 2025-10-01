/*:
 * @target MZ
 * @plugindesc Fonary: battle moves list shows Name + PP numbers only (no Type, no "PP" label). Single combined override.
 * @author You
 * @help
 * Place this plugin BELOW FonaryMoves_MZ.js.
 *
 * What it does:
 * - Replaces the battle moves row drawing with a compact layout:
 *     Left  ~70%: Move name
 *     Right ~30%: "current/max" (numbers only, no "PP " label)
 * - Hides the Type column entirely.
 * - If PP helpers (ppCurrent/ppMax) aren’t available, it falls back to the original drawing.
 */

(() => {
  // Keep a reference to the original drawItem, in case we need to fall back.
  const _drawItemOrig = Window_BattleSkill.prototype.drawItem;

  Window_BattleSkill.prototype.drawItem = function(index) {
    // Get the skill to draw
    const item = this.itemAt ? this.itemAt(index) : (this.item && this.item());
    if (!item) return;

    // Fetch PP via your Fonary helpers; if not present, fall back.
    const a = this._actor;
    let curPP = null, maxPP = null;
    if (a && typeof a.ppCurrent === "function" && typeof a.ppMax === "function") {
      try {
        curPP = a.ppCurrent(item.id);
        maxPP = a.ppMax(item.id);
      } catch (e) {
        // ignore; will fall back
      }
    }
    if (curPP == null || maxPP == null) {
      _drawItemOrig.call(this, index);
      return;
    }

    // Layout: Name (left) | "cur/max" (right)
    const r = this.itemLineRect(index);
    const nameW = Math.floor(r.width * 0.70);
    const numW  = r.width - nameW;

    // Enabled state + fade when no PP
    const enabled = this.isEnabled ? this.isEnabled(item) : true;
    this.changePaintOpacity(enabled && curPP > 0);
    this.resetTextColor();

    // Draw name
    this.drawText(item.name, r.x, r.y, nameW, "left");

    // Draw numbers only (no "PP " label)
    this.drawText(String(curPP) + "/" + String(maxPP), r.x + nameW, r.y, numW, "right");

    this.changePaintOpacity(true);
  };
})();
