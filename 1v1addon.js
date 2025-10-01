/*:
 * @target MZ
 * @plugindesc 1v1 auto-target ADD-ON: skips enemy selection when exactly one enemy is alive (keeps your original plugin intact).
 * @author You
 * @help
 * Place this AFTER your original FonaryAutoTarget1v1 plugin.
 * It only short-circuits the enemy picker for single-target opponent actions.
 */

(() => {
  "use strict";

  function onlyAliveEnemy() {
    const list = $gameTroop.aliveMembers();
    return list.length === 1 ? list[0] : null;
  }

  function isSingleOpponentAction(action) {
    return action
      && action.isForOpponent && action.isForOpponent()
      && action.isForOne && action.isForOne()
      && !action.isForRandom();
  }

  // Intercept the moment the game would open the enemy window
  const _selectEnemySelection = Scene_Battle.prototype.selectEnemySelection;
  Scene_Battle.prototype.selectEnemySelection = function () {
    const action = BattleManager.inputtingAction();
    const enemy  = onlyAliveEnemy();
    if (enemy && isSingleOpponentAction(action)) {
      if (this._enemyWindow) this._enemyWindow.hide();
      action.setTarget(enemy.index());
      this.selectNextCommand();
      return;
    }
    _selectEnemySelection.call(this);
  };

  // Some setups call startEnemySelection() instead; short-circuit that too.
  const _startEnemySelection = Scene_Battle.prototype.startEnemySelection;
  if (_startEnemySelection) {
    Scene_Battle.prototype.startEnemySelection = function () {
      const action = BattleManager.inputtingAction();
      const enemy  = onlyAliveEnemy();
      if (enemy && isSingleOpponentAction(action)) {
        if (this._enemyWindow) this._enemyWindow.hide();
        action.setTarget(enemy.index());
        this.selectNextCommand();
        return;
      }
      _startEnemySelection.call(this);
    };
  }
})();
