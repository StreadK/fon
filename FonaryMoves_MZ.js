/*:
 * @target MZ
 * @plugindesc Attack opens the default skill list (auto-skip type), LIMITED to first 4 learned skills. Shows PP + Type, disables at 0 PP, consumes PP on use.
 * @help
 * Put THIS PLUGIN LAST in Plugin Manager.
 *
 * In each Skill's Note:
 *   <PP: 20>
 *   <Type: Fire>
 */

(() => {
  // ------------ helpers ------------
  function skillPP(skill){ if(!skill) return 10; const m=/<PP:\s*(\d+)\s*>/i.exec(skill.note||""); return m?Math.max(0,Number(m[1])):10; }
  function skillType(skill){ if(!skill) return "—"; const m=/<Type:\s*([^>]+)\s*>/i.exec(skill.note||""); return m?m[1].trim():"—"; }

  // ------------ PP per actor ------------
  Game_Actor.prototype._ensureFonaryPP=function(){ if(!this._fonaryPP) this._fonaryPP={}; };
  Game_Actor.prototype.ppMax=function(id){ return skillPP($dataSkills[id]); };
  Game_Actor.prototype.ppCurrent=function(id){ this._ensureFonaryPP(); if(this._fonaryPP[id]==null) this._fonaryPP[id]=this.ppMax(id); return this._fonaryPP[id]; };
  Game_Actor.prototype.consumePP=function(id){ this._ensureFonaryPP(); if(this._fonaryPP[id]>0) this._fonaryPP[id]--; };

  const _BM_invokeAction = BattleManager.invokeAction;
  BattleManager.invokeAction = function(subject,target){
    if (subject?.isActor?.() && this._action?.isSkill()) subject.consumePP(this._action.item().id);
    _BM_invokeAction.call(this,subject,target);
  };

  // ------------ patch battle skill window ------------
  const _WBS_makeItemList = Window_BattleSkill.prototype.makeItemList;
  const _WBS_isEnabled    = Window_BattleSkill.prototype.isEnabled;
  const _WBS_drawItem     = Window_BattleSkill.prototype.drawItem;
  const _WBS_includes     = Window_BattleSkill.prototype.includes;

  // While our flag is on, ignore type filtering and show first 4 learned skills
  Window_BattleSkill.prototype.makeItemList = function(){
    if (this._fonaryLimitMoves) {
      const a = this._actor;
      this._data = a ? a.skills().slice(0,4) : [];
    } else {
      _WBS_makeItemList.call(this);
    }
  };

  // Bypass includes() (type filter) when limited mode is on
  Window_BattleSkill.prototype.includes = function(item){
    if (this._fonaryLimitMoves) return !!item;
    return _WBS_includes.call(this, item);
  };

  // Disable when PP = 0 (still respect engine checks like seal, cost, etc.)
  Window_BattleSkill.prototype.isEnabled = function(item){
    if (this._fonaryLimitMoves && item) {
      const a = this._actor;
      if (!a || a.ppCurrent(item.id) <= 0) return false;
      return _WBS_isEnabled.call(this, item);
    }
    return _WBS_isEnabled.call(this, item);
  };

  // Draw Name | PP | Type
  Window_BattleSkill.prototype.drawItem = function(index){
    if (!this._fonaryLimitMoves) return _WBS_drawItem.call(this, index);
    const item = this.itemAt(index); if (!item) return;
    const r = this.itemLineRect(index);
    const a = this._actor, cur=a.ppCurrent(item.id), max=a.ppMax(item.id), ty=skillType(item);
    if (cur<=0) this.changePaintOpacity(false);
    const nameW=Math.floor(r.width*0.45), ppW=Math.floor(r.width*0.25), typeW=r.width-nameW-ppW;
    this.drawText(item.name, r.x, r.y, nameW, "left");
    this.drawText(`PP ${cur}/${max}`, r.x+nameW, r.y, ppW, "center");
    this.drawText(ty, r.x+nameW+ppW, r.y, typeW, "right");
    this.changePaintOpacity(true);
  };

  // ------------ hook Attack → open engine skill UI then force our mode ------------
  const _SB_createActorCommandWindow = Scene_Battle.prototype.createActorCommandWindow;
  Scene_Battle.prototype.createActorCommandWindow = function(){
    _SB_createActorCommandWindow.call(this);
    this._actorCommandWindow.setHandler("attack", this.openMovesLikePokemon.bind(this));
  };

  Scene_Battle.prototype.openMovesLikePokemon = function(){
    const actor = BattleManager.actor();
    if (!actor){ this._actorCommandWindow.activate(); return; }

    // Open the built-in Skill flow
    this.commandSkill();

    // Auto-pick first type (we're going to ignore filtering anyway)
    if (this._skillTypeWindow){
      this._skillTypeWindow.select(0);
      this.onSkillTypeOk();
    }

    // Turn on our limited mode and refresh list
    if (this._skillWindow){
      this._skillWindow._fonaryLimitMoves = true;
      this._skillWindow.refresh();
      this._skillWindow.activate();
      this._skillWindow.select(0);
    }
  };

  // Restore default behaviour after OK/Cancel from skills
  const _SB_onSkillCancel = Scene_Battle.prototype.onSkillCancel;
  Scene_Battle.prototype.onSkillCancel = function(){
    if (this._skillWindow) this._skillWindow._fonaryLimitMoves = false;
    _SB_onSkillCancel.call(this);
  };
  const _SB_onSkillOk = Scene_Battle.prototype.onSkillOk;
  Scene_Battle.prototype.onSkillOk = function(){
    if (this._skillWindow) this._skillWindow._fonaryLimitMoves = false;
    _SB_onSkillOk.call(this);
  };
})();
