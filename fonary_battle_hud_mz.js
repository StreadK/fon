/*:
 * @target MZ
 * @plugindesc 1v1 Battle HUD: Enemy TL, Ally BR (auto avoids bottom UI). Bottom command row + bottom moves row. Items full-screen dim. Rounded panels w/ border. HP numbers above bar. No state icons. No top help window.
 * @author You
 * @help
 * Put this below your other Fonary/battle plugins.
 *
 * Changes vs default:
 * - Enemy HUD top-left; Ally HUD bottom-right (rounded 80% panels, stylish border).
 * - Actor Commands: full-width single row at the very bottom.
 * - Moves (after "Attack"): full-width single row at the very bottom.
 * - Items: full-screen with dim background; HUD hides while items open.
 * - Ally HUD auto-lifts to avoid bottom rows.
 * - HP numbers centered above HP bar (never overlapped).
 * - State icons removed (no skulls, etc.): not on HUD, not above battlers.
 * - Battle help window (top text box) hidden/disabled — no top text.
 *
 * @param HideDefaultStatus
 * @type boolean @default true
 * @text Hide Default Status Window
 * @param RemoveTouchArrow
 * @type boolean @default true
 * @text Remove Touch Arrow Button (Battle)
 *
 * @param AllyX @type number @default -1 @text Ally Panel X (−1 = auto right)
 * @param AllyY @type number @default -1 @text Ally Panel Y (−1 = auto bottom, safe)
 * @param EnemyX @type number @default 24 @text Enemy Panel X
 * @param EnemyY @type number @default 24 @text Enemy Panel Y
 *
 * @param PanelWidth  @type number @default 360 @text Panel Width
 * @param PanelHeight @type number @default 84  @text Panel Height
 * @param GaugeWidth  @type number @default 240 @text Gauge Width
 * @param GaugeHeight @type number @default 10  @text Gauge Height
 *
 * @param Colors
 * @type struct<FonaryHudColors>
 * @default {"panelBg":"#101418","panelOutline":"#222830","hp1":"#3cff4e","hp2":"#0cad21","hpLow":"#ff7043","exp":"#3fa7ff","text":"#ffffff","subtext":"#a8b0bd","borderAccent":"#ffffff"}
 * @text Colors
 *
 * @param CornerRadius   @type number @min 0 @default 12 @text Panel Corner Radius
 * @param PanelOpacity   @type number @min 0 @max 100 @default 80 @text Panel Fill Opacity (0–100)
 * @param OutlineWidth   @type number @min 1 @default 2  @text Panel Outer Border Width
 * @param BorderShadow   @type boolean @default true     @text Panel Shadow
 * @param BorderAccentOpacity @type number @min 0 @max 100 @default 22 @text Inner Highlight Opacity (0–100)
 * @param AllySafeGap    @type number @default 6 @text Extra Gap Above Bottom UI (px)
 *
 * @param AnimateHp  @type boolean @default true @text Animate HP Change
 * @param AnimateExp @type boolean @default true @text Animate EXP Change
 * @param AnimSpeed  @type number  @default 4    @text Animation Speed (px/frame)
 *
 * @command RefreshHUD
 * @text Refresh HUD Now
 */
 /*~struct~FonaryHudColors:
 * @param panelBg        @type string @default #101418 @text Panel BG (hex)
 * @param panelOutline   @type string @default #222830 @text Panel Outline (hex)
 * @param borderAccent   @type string @default #ffffff @text Inner Highlight (hex)
 * @param hp1            @type string @default #3cff4e @text HP (main)
 * @param hp2            @type string @default #0cad21 @text HP (shadow)
 * @param hpLow          @type string @default #ff7043 @text HP (low)
 * @param exp            @type string @default #3fa7ff @text EXP
 * @param text           @type string @default #ffffff @text Text
 * @param subtext        @type string @default #a8b0bd @text Subtext
 */

(() => {
  const PM = PluginManager.parameters.bind(PluginManager);
  const P = Object.keys(PM("FonaryBattleHUD_MZ")).length ? PM("FonaryBattleHUD_MZ") : PM("fonary_battle_hud_mz");

  const HIDE_DEFAULT = String(P.HideDefaultStatus||"true")==="true";
  const REMOVE_TOUCH = String(P.RemoveTouchArrow||"true")==="true";

  const AX  = Number(P.AllyX||-1), AY  = Number(P.AllyY||-1);
  const EX  = Number(P.EnemyX||24), EY  = Number(P.EnemyY||24);

  const PW  = Number(P.PanelWidth||360), PH  = Number(P.PanelHeight||84);
  const GW  = Number(P.GaugeWidth||240), GH  = Number(P.GaugeHeight||10);

  const CORNER_RADIUS = Math.max(0, Number(P.CornerRadius||12));
  const PANEL_ALPHA   = Math.max(0, Math.min(100, Number(P.PanelOpacity||80))) / 100;
  const OUTLINE_W     = Math.max(1, Number(P.OutlineWidth||2));
  const BORDER_SHADOW = String(P.BorderShadow||"true")==="true";
  const ACCENT_OPA    = Math.max(0, Math.min(100, Number(P.BorderAccentOpacity||22))) / 100;
  const ALLY_SAFE_GAP = Number(P.AllySafeGap||6);

  const ANIM_HP  = String(P.AnimateHp||"true")==="true";
  const ANIM_EXP = String(P.AnimateExp||"true")==="true";
  const ANIM_SPEED = Math.max(1, Number(P.AnimSpeed||4));

  let COLORS={}; try{ COLORS=JSON.parse(P.Colors||"{}"); }catch(e){ COLORS={}; }
  COLORS.panelBg      ||= "#101418";
  COLORS.panelOutline ||= "#222830";
  COLORS.borderAccent ||= "#ffffff";
  COLORS.hp1          ||= "#3cff4e";
  COLORS.hp2          ||= "#0cad21";
  COLORS.hpLow        ||= "#ff7043";
  COLORS.exp          ||= "#3fa7ff";
  COLORS.text         ||= "#ffffff";
  COLORS.subtext      ||= "#a8b0bd";

  // helpers
  const clamp=(a,b,c)=>Math.max(b,Math.min(c,a));
  function hexToRgb(hex){ let h=String(hex||"#000").replace("#",""); if(h.length===3) h=h.split("").map(c=>c+c).join(""); const n=parseInt(h,16); return {r:(n>>16)&255,g:(n>>8)&255,b:(n)&255}; }
  function rgba(hex,a){ const {r,g,b}=hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function drawRoundRect(ctx,x,y,w,h,r){ const rr=Math.max(0,Math.min(r,Math.min(w,h)/2)); ctx.beginPath(); ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr); ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath(); }
  function drawText(bitmap, text, x,y,w,align,color){ const old=bitmap.textColor; if(color) bitmap.textColor=color; bitmap.drawText(String(text),x,y,w,28,align||"left"); if(color) bitmap.textColor=old; }

  // gauges
  class GaugeBar extends Sprite {
    constructor(w,h,c1,c2){ super(new Bitmap(w,h)); this._w=w; this._h=h; this._c1=c1; this._c2=c2||c1; this._rate=1; this._target=1; }
    setRate(r,a){ r=clamp(r,0,1); this._target=r; if(!a){ this._rate=r; this.redraw(); } }
    update(){ super.update(); if(this._rate!==this._target){ const d=Math.sign(this._target-this._rate)*(ANIM_SPEED/this._w); if(Math.abs(this._target-this._rate)<=Math.abs(d)) this._rate=this._target; else this._rate+=d; this.redraw(); } }
    redraw(){ const b=this.bitmap; b.clear(); const w=Math.round(this._w*this._rate); if(w<=0) return; b.fillRect(0,0,w,this._h,this._c2); b.fillRect(0,0,w,Math.max(1,this._h-2),this._c1); }
  }

  // panel base
  class PanelBase extends Sprite {
    constructor(w,h){ super(new Bitmap(w,h)); this._w=w; this._h=h; this._contents=new Sprite(new Bitmap(w,h)); this.addChild(this._contents); this.drawPanel(); }
    drawPanel(){
      const b=this.bitmap, ctx=b.context; b.clear();
      // shadowed rounded fill
      ctx.save(); if(BORDER_SHADOW){ ctx.shadowColor="rgba(0,0,0,0.30)"; ctx.shadowBlur=8; ctx.shadowOffsetX=0; ctx.shadowOffsetY=3; }
      drawRoundRect(ctx,0.5,0.5,this._w-1,this._h-1,CORNER_RADIUS); ctx.fillStyle=rgba(COLORS.panelBg,PANEL_ALPHA); ctx.fill(); ctx.restore();
      // outer border
      ctx.save(); ctx.lineWidth=OUTLINE_W; ctx.strokeStyle=COLORS.panelOutline; drawRoundRect(ctx,0.5,0.5,this._w-1,this._h-1,CORNER_RADIUS); ctx.stroke(); ctx.restore();
      // inner highlight
      if(ACCENT_OPA>0){ ctx.save(); ctx.lineWidth=1; ctx.strokeStyle=rgba(COLORS.borderAccent,ACCENT_OPA); drawRoundRect(ctx,1.5,1.5,this._w-3,this._h-3,Math.max(0,CORNER_RADIUS-1)); ctx.stroke(); ctx.restore(); }
      if (typeof b._setDirty==="function") b._setDirty();
      else if (b.baseTexture&&b.baseTexture.update) b.baseTexture.update();
      else if (b._baseTexture&&b._baseTexture.update) b._baseTexture.update();
    }
    contents(){ return this._contents.bitmap; }
  }

  // ally panel (HP numbers centered above bar)
  class AllyPanel extends PanelBase {
    constructor(){
      super(PW,PH);
      this._a=null;
      this._hp=new GaugeBar(GW,GH,COLORS.hp1,COLORS.hp2); this._hp.x=100; this._hp.y=36; this.addChild(this._hp);
      this._exp=new GaugeBar(GW,6,COLORS.exp,COLORS.exp);  this._exp.x=100; this._exp.y=this._hp.y+GH+8; this.addChild(this._exp);
      this._hpText = new Sprite(new Bitmap(GW, 22)); this._hpText.x=this._hp.x; this._hpText.y=this._hp.y-18; this.addChild(this._hpText);
    }
    setActor(a){ this._a=a; this.refresh(true); }
    actor(){ return this._a; }
    refresh(){
      const c=this.contents(); c.clear(); this._hpText.bitmap.clear();
      if(!this._a){ this._hp.setRate(0,false); this._exp.setRate(0,false); return; }
      const a=this._a;
      c.fontSize=22; drawText(c,a.name(),14,6,240,"left",COLORS.text);
      c.fontSize=18; drawText(c,"Lv "+a.level,this._w-80,8,70,"right",COLORS.subtext);
      c.fontSize=14; drawText(c,"HP",70,32,28,"left",COLORS.subtext);
      drawText(c,"EXP",70,this._exp.y-2,40,"left",COLORS.subtext);
      this._hp.setRate(a.mhp>0?a.hp/a.mhp:0,ANIM_HP);
      const cur=a.currentExp?a.currentExp():a._exp, next=a.nextLevelExp?a.nextLevelExp():0, base=a.currentLevelExp?a.currentLevelExp():0;
      const r=(next>base)?clamp((cur-base)/(next-base),0,1):0; this._exp.setRate(r,ANIM_EXP);
      const hb=this._hpText.bitmap; hb.fontFace=$gameSystem.mainFontFace(); hb.fontSize=18; hb.textColor=COLORS.text; hb.drawText(`${a.hp}/${a.mhp}`,0,0,GW,22,"center");
    }
    update(){ super.update(); const a=this._a; if(!a) return;
      if(this._lh!==a.hp||this._lm!==a.mhp||this._ll!==a.level){ this._lh=a.hp; this._lm=a.mhp; this._ll=a.level; this.refresh(); }
      if(a.currentExp && this._le!==a.currentExp()){ this._le=a.currentExp(); this.refresh(); }
    }
  }

  // enemy panel (no state icon drawn)
  class EnemyPanel extends PanelBase {
    constructor(){ super(PW,PH); this._e=null; this._hp=new GaugeBar(GW,GH,COLORS.hp1,COLORS.hp2); this._hp.x=100; this._hp.y=36; this.addChild(this._hp); }
    setEnemy(e){ this._e=e; this.refresh(true); }
    enemy(){ return this._e; }
    refresh(){
      const c=this.contents(); c.clear();
      if(!this._e){ this._hp.setRate(0,false); return; }
      const e=this._e;
      c.fontSize=22; drawText(c,e.name(),14,6,240,"left",COLORS.text);
      const lv = e.level ? e.level : (e._fonaryLevelOverride||1);
      c.fontSize=18; drawText(c,"Lv "+lv,this._w-80,8,70,"right",COLORS.subtext);
      c.fontSize=14; drawText(c,"HP",70,32,28,"left",COLORS.subtext);
      this._hp.setRate(e.mhp>0?e.hp/e.mhp:0,ANIM_HP);
    }
    update(){ super.update(); const e=this._e; if(!e) return; if(this._lh!==e.hp||this._lm!==e.mhp){ this._lh=e.hp; this._lm=e.mhp; this.refresh(); } }
  }

  // HUD layer (auto-lift ally HUD above bottom UI)
  class HudLayer extends Sprite {
    constructor(){ super(); this._ally=new AllyPanel(); this._enemy=new EnemyPanel(); this._bottomSafe=0; this.addChild(this._ally); this.addChild(this._enemy); this.positionPanels(); }
    setBottomSafe(px){ this._bottomSafe=Math.max(0,px|0); this.positionPanels(); }
    positionPanels(){
      const margin=24;
      this._enemy.x=Math.max(0,EX); this._enemy.y=Math.max(0,EY);
      const right=(AX<0)?(Graphics.boxWidth - margin - PW):AX;
      const bottomBase=(AY<0)?(Graphics.boxHeight - Math.max(margin,this._bottomSafe+ALLY_SAFE_GAP) - PH):AY;
      this._ally.x=right; this._ally.y=Math.max(0,bottomBase);
    }
    setBattlers(a,e){ this._ally.setActor(a||null); this._enemy.setEnemy(e||null); }
    refresh(){ this._ally.refresh(true); this._enemy.refresh(true); this.positionPanels(); }
  }

  // scene hooks
  const _SB_createAllWindows=Scene_Battle.prototype.createAllWindows;
  Scene_Battle.prototype.createAllWindows=function(){
    _SB_createAllWindows.call(this);
    if(HIDE_DEFAULT && this._statusWindow){ this._statusWindow.close(); this._statusWindow.visible=false; this._statusWindow.opacity=0; this._statusWindow.height=0; this._statusWindow.y=Graphics.boxHeight+100; }
    this._fonHud=new HudLayer(); this.addChild(this._fonHud); this.refreshFonHud();
  };
  Scene_Battle.prototype.refreshFonHud=function(){ const a=this.fonActiveActor(); const e=this.fonActiveEnemy(); if(this._fonHud) this._fonHud.setBattlers(a,e); };
  Scene_Battle.prototype.fonActiveActor=function(){ const s=BattleManager._subject; if(s&&s.isActor&&s.isActor()) return s; const alive=$gameParty.aliveMembers(); return alive.length?alive[0]:null; };
  Scene_Battle.prototype.fonActiveEnemy=function(){ const list=$gameTroop.members(); for(const en of list) if(en&&en.isAlive()&&!en.isHidden()) return en; for(const en of list) if(en&&en.isAlive()) return en; return null; };

  const _SB_update=Scene_Battle.prototype.update;
  Scene_Battle.prototype.update=function(){
    _SB_update.call(this);
    if(this._fonHud){
      const a=this.fonActiveActor(), e=this.fonActiveEnemy();
      if(this._fonHud._ally._a!==a||this._fonHud._enemy._e!==e) this._fonHud.setBattlers(a,e);
      let safe=0;
      if(this._skillWindow && this._skillWindow.visible) safe=Math.max(safe, Graphics.boxHeight - this._skillWindow.y);
      if(this._actorCommandWindow && this._actorCommandWindow.visible) safe=Math.max(safe, Graphics.boxHeight - this._actorCommandWindow.y);
      this._fonHud.setBottomSafe(safe);
    }
    if(this._itemWindow) this._fonHud.visible = !this._itemWindow.visible;
    if(REMOVE_TOUCH && this._cancelButton){ this._cancelButton.visible=false; this._cancelButton.opacity=0; }
  };
  const _SB_createButtons=Scene_Battle.prototype.createButtons;
  Scene_Battle.prototype.createButtons=function(){ _SB_createButtons.call(this); if(REMOVE_TOUCH && this._cancelButton){ this._cancelButton.visible=false; this._cancelButton.opacity=0; } };

  // Hide the top help window entirely (no top text)
  const _SB_createHelpWindow = Scene_Battle.prototype.createHelpWindow;
  Scene_Battle.prototype.createHelpWindow = function() {
    _SB_createHelpWindow.call(this);
    if (this._helpWindow) {
      this._helpWindow.visible = false;
      this._helpWindow.opacity = 0;
      this._helpWindow.height  = 0;
      this._helpWindow.y       = Graphics.boxHeight + 100; // off-screen
    }
  };

  // bottom row helper
  const SIDE_MARGIN=24, BOTTOM_MARGIN=0;
  function placeBottomRow(win){ if(!win) return; const w=Graphics.boxWidth - SIDE_MARGIN*2, h=win.fittingHeight(1), x=SIDE_MARGIN, y=Graphics.boxHeight-h-BOTTOM_MARGIN; win.move(x,y,w,h); win.createContents(); win.refresh(); }

  // actor command bottom row
  Window_ActorCommand.prototype.maxCols=function(){ return 4; };
  Window_ActorCommand.prototype.numVisibleRows=function(){ return 1; };
  Window_ActorCommand.prototype.itemTextAlign=function(){ return "center"; };
  Window_ActorCommand.prototype.windowWidth=function(){ return Graphics.boxWidth - SIDE_MARGIN*2; };
  Window_ActorCommand.prototype.windowHeight=function(){ return this.fittingHeight(1); };
  const _SB_createActorCommandWindow=Scene_Battle.prototype.createActorCommandWindow;
  Scene_Battle.prototype.createActorCommandWindow=function(){ _SB_createActorCommandWindow.call(this); placeBottomRow(this._actorCommandWindow); };
  const _SB_startActorCommandSelection=Scene_Battle.prototype.startActorCommandSelection;
  Scene_Battle.prototype.startActorCommandSelection=function(){ _SB_startActorCommandSelection.call(this); placeBottomRow(this._actorCommandWindow); };

  // moves list as bottom row
  const SK_COLS=4;
  Window_BattleSkill.prototype.maxCols=function(){ return SK_COLS; };
  Window_BattleSkill.prototype.numVisibleRows=function(){ return 1; };
  Window_BattleSkill.prototype.itemTextAlign=function(){ return "center"; };
  Window_BattleSkill.prototype.windowWidth=function(){ return Graphics.boxWidth - SIDE_MARGIN*2; };
  Window_BattleSkill.prototype.windowHeight=function(){ return this.fittingHeight(1); };
  const _SB_createSkillWindow=Scene_Battle.prototype.createSkillWindow;
  Scene_Battle.prototype.createSkillWindow=function(){ _SB_createSkillWindow.call(this); placeBottomRow(this._skillWindow); this._skillWindow.setHandler("cancel", this.onSkillCancel.bind(this)); };
  const _SB_commandAttack=Scene_Battle.prototype.commandAttack;
  Scene_Battle.prototype.commandAttack=function(){ _SB_commandAttack.call(this); if(this._skillWindow) placeBottomRow(this._skillWindow); };
  const _SB_onSkillOk=Scene_Battle.prototype.onSkillOk;
  Scene_Battle.prototype.onSkillOk=function(){ _SB_onSkillOk.call(this); setTimeout(()=>{ if(this._actorCommandWindow) placeBottomRow(this._actorCommandWindow); },0); };
  const _SB_onSkillCancel=Scene_Battle.prototype.onSkillCancel;
  Scene_Battle.prototype.onSkillCancel=function(){ _SB_onSkillCancel.call(this); if(this._actorCommandWindow) placeBottomRow(this._actorCommandWindow); };

  // items full-screen + dim
  const _SB_createItemWindow=Scene_Battle.prototype.createItemWindow;
  Scene_Battle.prototype.createItemWindow=function(){ _SB_createItemWindow.call(this); const w=this._itemWindow; if(w){ w.setBackgroundType(1); w.move(0,0,Graphics.boxWidth,Graphics.boxHeight); w.createContents(); w.refresh(); } };

  // Remove floating state icons above battlers (in battle sprites)
  const _SB_createStateIconSprite = Sprite_Battler.prototype.createStateIconSprite;
  Sprite_Battler.prototype.createStateIconSprite = function(){
    _SB_createStateIconSprite.call(this);
    if (this._stateIconSprite) this._stateIconSprite.visible = false;
  };
  const _SB_updateStateSprite = Sprite_Battler.prototype.updateStateSprite;
  Sprite_Battler.prototype.updateStateSprite = function(){
    _SB_updateStateSprite.call(this);
    if (this._stateIconSprite) this._stateIconSprite.visible = false;
  };

  // plugin command
  PluginManager.registerCommand("FonaryBattleHUD_MZ","RefreshHUD",()=>{ const s=SceneManager._scene; if(s&&s._fonHud) s._fonHud.refresh(); });
})();
