/*:
 * @plugindesc Set maximum number of battle members (default 4).
 * @param MaxBattleMembers
 * @type number
 * @min 1
 * @default 1
 */

(function() {
  var parameters = PluginManager.parameters('MaxBattleMembers');
  var max = Number(parameters['MaxBattleMembers'] || 1);

  Game_Party.prototype.maxBattleMembers = function() {
    return max;
  };
})();