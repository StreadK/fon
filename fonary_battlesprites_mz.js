/*:
 * @target MZ
 * @plugindesc Fonary Battle Sprites Combo: Ally back sprite (bottom-left, autoscale) + Enemy front from img/fonary (pattern/tag) with autoscale. Back-sprite sits under all windows.
 * @author You
 * @help
 * Ally back sprite:
 *   - Put image in: img/fonary/
 *   - Actor note: <BackSprite: Flamlet_back>
 *     or Actor note/species: <SpeciesId: Flamlet> and keep FilePattern = "%s_back"
 *
 * Enemy front sprite:
 *   - Put image in: img/fonary/
 *   - Enemy note: <FrontSprite: Flamlet_front>  // overrides pattern
 *     or Enemy note: <SpeciesId: Flamlet>       // uses EnemyFilePattern = "%s_front"
 *   - If no tags, tries enemy's name (e.g., "Flamlet") with the pattern.
 *   - Falls back to DB battler if nothing resolves.
 *
 * Both ally back and enemy front are auto-scaled to MaxHeight/MaxWidth (aspect kept).
 * Place BELOW your HUD / battle plugins.
 *
 * @param --- Ally Back Sprite ---
 * @default
 *
 * @param ImageFolder
 * @text Ally Image Folder (relative)
 * @parent --- Ally Back Sprite ---
 * @type string
 * @default img/fonary/
 *
 * @param FilePattern
 * @text Ally File name pattern (%s = speciesId)
 * @parent --- Ally Back Sprite ---
 * @type string
 * @default %s_back
 *
 * @param X
 * @text Ally X (−1 = auto left margin)
 * @parent --- Ally Back Sprite ---
 * @type number
 * @default -1
 *
 * @param Y
 * @text Ally Y (−1 = auto above bottom UI)
 * @parent --- Ally Back Sprite ---
 * @type number
 * @default -1
 *
 * @param LeftMargin
 * @text Ally Left Margin (auto)
 * @parent --- Ally Back Sprite ---
 * @type number
 * @default 20
 *
 * @param BottomMargin
 * @text Ally Bottom Margin (gap)
 * @parent --- Ally Back Sprite ---
 * @type number
 * @default 8
 *
 * @param MaxHeight
 * @text Ally Max Height (px) [0 = none]
 * @parent --- Ally Back Sprite ---
 * @type number
 * @default 240
 *
 * @param MaxWidth
 * @text Ally Max Width (px) [0 = none]
 * @parent --- Ally Back Sprite ---
 * @type number
 * @default 0
 *
 * @param Opacity
 * @text Ally Opacity (0–255)
 * @parent --- Ally Back Sprite ---
 * @type number
 * @min 0
 * @max 255
 * @default 255
 *
 * @param --- Enemy Front (from folder) ---
 * @default
 *
 * @param EnemyImageFolder
 * @text Enemy Image Folder (relative)
 * @parent --- Enemy Front (from folder) ---
 * @type string
 * @default img/fonary/
 *
 * @param EnemyFilePattern
 * @text Enemy File name pattern (%s = speciesId/name)
 * @parent --- Enemy Front (from folder) ---
 * @type string
 * @default %s_front
 *
 * @param EnemyMaxHeight
 * @text Enemy Max Height (px) [0 = none]
 * @parent --- Enemy Front (from folder) ---
 * @type number
 * @default 300
 *
 * @param EnemyMaxWidth
 * @text Enemy Max Width (px) [0 = none]
 * @parent --- Enemy Front (from folder) ---
 * @type number
 * @default 0
 *
 * @param EnemyMinScale
 * @text Enemy Min Scale [0 = no clamp]
 * @parent --- Enemy Front (from folder) ---
 * @type number
 * @decimals 2
 * @default 0
 *
 * @param EnemyMaxScale
 * @text Enemy Max Scale [0 = no clamp]
 * @parent --- Enemy Front (from folder) ---
 * @type number
 * @decimals 2
 * @default 0
 *
 * @param EnemyOffsetX
 * @text Enemy Offset X (px)
 * @parent --- Enemy Front (from folder) ---
 * @type number
 * @default 0
 *
 * @param EnemyOffsetY
 * @text Enemy Offset Y (px)
 * @parent --- Enemy Front (from folder) ---
 * @type number
 * @default 0
 */

(() => {
  "use strict";

  const PN = "fonary_battlesprites_mz";
  const P  = PluginManager.parameters(PN);

  // Ally params
  const IMG_FOLDER    = String(P.ImageFolder || "img/fonary/");
  const FILE_PATTERN  = String(P.FilePattern || "%s_back");
  const PAR_X         = Number(P.X || -1);
  const PAR_Y         = Number(P.Y || -1);
  const LEFT_MARGIN   = Number(P.LeftMargin || 20);
  const BOTTOM_MARGIN = Number(P.BottomMargin || 8);
  const MAX_H         = Number(P.MaxHeight || 240);
  const MAX_W         = Number(P.MaxWidth  || 0);
  const OPACITY       = Math.max(0, Math.min(255, Number(P.Opacity || 255)));

  // Enemy params
  const E_FOLDER  = String(P.EnemyImageFolder || "img/fonary/");
  const E_PATTERN = String(P.EnemyFilePattern || "%s_front");
  const E_MAX_H   = Number(P.EnemyMaxHeight || 300);
  const E_MAX_W   = Number(P.EnemyMaxWidth  || 0);
  const E_MIN_S   = Number(P.EnemyMinScale  || 0);
  const E_MAX_S   = Number(P.EnemyMaxScale  || 0);
  const E_OFF_X   = Number(P.EnemyOffsetX   || 0);
  const E_OFF_Y   = Number(P.EnemyOffsetY   || 0);

  // ---------- helpers ----------
  function clampScale(v, minS, maxS){
    if (minS > 0) v = Math.max(minS, v);
    if (maxS > 0) v = Math.min(maxS, v);
    return v;
  }
  function readTag(note, tag){
    const re = new RegExp("<"+tag+":\\s*([^>]+)\\s*>","i");
    const m = (note||"").match(re);
    return m ? String(m[1]).trim() : "";
  }

  // species helpers
  function speciesFromActor(a){
    if (a && a._fonary && a._fonary.speciesId) return String(a._fonary.speciesId);
    const data = $dataActors[a && a.actorId ? a.actorId() : 0];
    return data ? readTag(data.note, "SpeciesId") : "";
  }
  function backNameFromActor(a){
    const data = $dataActors[a && a.actorId ? a.actorId() : 0];
    const tagName = data ? readTag(data.note, "BackSprite") : "";
    if (tagName) return tagName;
    const sp = speciesFromActor(a);
    return sp ? FILE_PATTERN.replace("%s", sp) : "";
  }

  function speciesFromEnemy(enemyObj, gameEnemy){
    const spTag = enemyObj ? readTag(enemyObj.note, "SpeciesId") : "";
    if (spTag) return spTag;
    if (gameEnemy && gameEnemy._fonarySpeciesId) return String(gameEnemy._fonarySpeciesId);
    if (gameEnemy && gameEnemy.name) return String(gameEnemy.name());
    return enemyObj ? String(enemyObj.name || "") : "";
  }

  function frontNameFromEnemy(gameEnemy){
    const obj = gameEnemy ? gameEnemy.enemy() : null;
    const explicit = obj ? readTag(obj.note, "FrontSprite") : "";
    if (explicit) return explicit;
    const sp = speciesFromEnemy(obj, gameEnemy);
    if (sp) return E_PATTERN.replace("%s", sp);
    return "";
  }

  // ---------- ImageManager loaders ----------
  ImageManager.loadFonaryBack  = function(filename){ return this.loadBitmap(IMG_FOLDER, filename); };
  ImageManager.loadFonaryFront = function(filename){ return this.loadBitmap(E_FOLDER,   filename); };

  // ---------- Ally back sprite ----------
  function Sprite_FonaryBack(){ this.initialize.apply(this, arguments); }
  Sprite_FonaryBack.prototype = Object.create(Sprite.prototype);
  Sprite_FonaryBack.prototype.constructor = Sprite_FonaryBack;

  Sprite_FonaryBack.prototype.initialize = function(){
    Sprite.prototype.initialize.call(this);
    this.anchor.set(0, 1); // bottom-left
    this._actor = null;
    this._filename = "";
    this.opacity = OPACITY;
  };

  Sprite_FonaryBack.prototype.setActor = function(actor){
    if (this._actor === actor) return;
    this._actor = actor;
    this.refresh();
  };

  Sprite_FonaryBack.prototype.refresh = function(){
    this.bitmap = null; this._filename = "";
    if (!this._actor) return;

    const file = backNameFromActor(this._actor);
    if (!file) return;

    this._filename = file;
    const bm = ImageManager.loadFonaryBack(file);
    this.bitmap = bm;

    const self = this;
    const doScale = function(){
      const w = bm.width  || 0;
      const h = bm.height || 0;
      if (w <= 0 || h <= 0) return;

      let sx = 1, sy = 1;
      if (MAX_W > 0) sx = Math.min(1, MAX_W / w);
      if (MAX_H > 0) sy = Math.min(1, MAX_H / h);

      let s;
      if (MAX_W > 0 && MAX_H > 0) s = Math.min(sx, sy);
      else if (MAX_W > 0)         s = sx;
      else if (MAX_H > 0)         s = sy;
      else                        s = 1;

      self.scale.set(s, s);
    };

    if (bm.isReady()) doScale();
    else bm.addLoadListener(doScale);
  };

  // ---------- Scene_Battle integration (ally under windows) ----------
  // Create back sprite during createSpriteset, BEFORE windows are created,
  // so every window (incl. bottom message) is drawn above the back sprite.
  const _SB_createSpriteset = Scene_Battle.prototype.createSpriteset;
  Scene_Battle.prototype.createSpriteset = function(){
    _SB_createSpriteset.call(this);
    this._fonaryBackSprite = new Sprite_FonaryBack();
    this.addChild(this._fonaryBackSprite); // added before windows → sits beneath them
    const firstAlive = $gameParty.aliveMembers().length ? $gameParty.aliveMembers()[0] : $gameParty.members()[0];
    this._fonaryBackSprite.setActor(firstAlive || null);
    this._fonaryBackSprite.x = (PAR_X >= 0) ? PAR_X : LEFT_MARGIN;
    this._placeBackSpriteY();
  };

  Scene_Battle.prototype._bottomUiSafeHeight = function(){
    let safe = 0;
    if (this._skillWindow && this._skillWindow.visible)       safe = Math.max(safe, Graphics.boxHeight - this._skillWindow.y);
    if (this._actorCommandWindow && this._actorCommandWindow.visible) safe = Math.max(safe, Graphics.boxHeight - this._actorCommandWindow.y);
    return safe;
  };

  Scene_Battle.prototype._placeBackSpriteY = function(){
    const spr = this._fonaryBackSprite; if (!spr) return;
    if (PAR_Y >= 0) { spr.y = PAR_Y; return; }
    const safe = this._bottomUiSafeHeight();
    spr.y = Graphics.boxHeight - Math.max(0, safe) - BOTTOM_MARGIN;
  };

  const _SB_update = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function(){
    _SB_update.call(this);

    const spr = this._fonaryBackSprite;
    if (spr){
      const a = $gameParty.aliveMembers().length ? $gameParty.aliveMembers()[0] : $gameParty.members()[0];
      if (spr._actor !== a) spr.setActor(a);
      this._placeBackSpriteY();
      spr.visible = !(this._itemWindow && this._itemWindow.visible);
    }
  };

  // ---------- Enemy front from folder + autoscale ----------
  const _SpriteEnemy_loadBitmap = Sprite_Enemy.prototype.loadBitmap;
  Sprite_Enemy.prototype.loadBitmap = function(name, hue){
    const frontFile = frontNameFromEnemy(this._enemy);
    if (frontFile){
      const bm = ImageManager.loadFonaryFront(frontFile);
      this.bitmap = bm;
      const sprite = this;
      const applyScale = function(){
        const w = bm.width  || 0;
        const h = bm.height || 0;
        if (w <= 0 || h <= 0) return;

        let sx = 1, sy = 1;
        if (E_MAX_W > 0) sx = Math.min(1, E_MAX_W / w);
        if (E_MAX_H > 0) sy = Math.min(1, E_MAX_H / h);

        let s;
        if (E_MAX_W > 0 && E_MAX_H > 0) s = Math.min(sx, sy);
        else if (E_MAX_W > 0)           s = sx;
        else if (E_MAX_H > 0)           s = sy;
        else                            s = 1;

        s = clampScale(s, E_MIN_S, E_MAX_S);
        sprite.scale.set(s, s);

        if (E_OFF_X) sprite.x += E_OFF_X;
        if (E_OFF_Y) sprite.y += E_OFF_Y;
      };

      if (bm.isReady()) applyScale();
      else bm.addLoadListener(applyScale);
      return;
    }

    // Fallback to DB battler + autoscale
    _SpriteEnemy_loadBitmap.call(this, name, hue);

    const bm2 = this.bitmap;
    const sprite2 = this;
    if (!bm2) return;

    const scaleDb = function(){
      const w = bm2.width  || 0;
      const h = bm2.height || 0;
      if (w <= 0 || h <= 0) return;

      let sx = 1, sy = 1;
      if (E_MAX_W > 0) sx = Math.min(1, E_MAX_W / w);
      if (E_MAX_H > 0) sy = Math.min(1, E_MAX_H / h);

      let s;
      if (E_MAX_W > 0 && E_MAX_H > 0) s = Math.min(sx, sy);
      else if (E_MAX_W > 0)           s = sx;
      else if (E_MAX_H > 0)           s = sy;
      else                            s = 1;

      s = clampScale(s, E_MIN_S, E_MAX_S);
      sprite2.scale.set(s, s);

      if (E_OFF_X) sprite2.x += E_OFF_X;
      if (E_OFF_Y) sprite2.y += E_OFF_Y;
    };

    if (bm2.isReady()) scaleDb();
    else bm2.addLoadListener(scaleDb);
  };

})();
