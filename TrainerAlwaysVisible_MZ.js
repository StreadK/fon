/*:
 * @target MZ
 * @plugindesc Force-draw the trainer on maps. If player/trainer has no charset, use a fallback. Prevent transparency/opacity glitches. (Hard fix at sprite level.)
 * @help Place this plugin FIRST in Plugin Manager.
 */
(() => {
  // Change to a charset you actually have in img/characters/
  const FALLBACK_CHARSET = "Actor1";
  const FALLBACK_INDEX   = 0; // 0..7

  // --- Helpers (read trainer from party slot 0; don't use leader/members) ---
  function trainerActor() {
    const id = $gameParty && $gameParty._actors ? $gameParty._actors[0] : 0;
    return id ? $gameActors.actor(id) : null;
  }
  function trainerGraphic() {
    const a = trainerActor();
    if (a && a.characterName && a.characterName()) {
      return { name: a.characterName(), index: a.characterIndex() };
    }
    return { name: FALLBACK_CHARSET, index: FALLBACK_INDEX };
  }

  // --- Ensure player data is sane every frame on maps (belt & suspenders) ---
  function enforcePlayerData() {
    if (!$gamePlayer) return;
    $gamePlayer.setTransparent(false);
    $gamePlayer._opacity = 255;
    $gamePlayer._blendMode = 0;
    $gamePlayer._through = false;

    const g = trainerGraphic();
    // Force the data the renderer expects
    $gamePlayer._characterName  = g.name;
    $gamePlayer._characterIndex = g.index;
  }

  // Run on map lifecycle
  const _Scene_Map_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function() { _Scene_Map_start.call(this); enforcePlayerData(); };
  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() { _Scene_Map_update.call(this); enforcePlayerData(); };
  const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function() { _Scene_Map_onMapLoaded.call(this); enforcePlayerData(); };

  // --- HARD FIX: patch the sprite to always have a bitmap for the player ----
  const _Sprite_Character_updateBitmap = Sprite_Character.prototype.updateBitmap;
  Sprite_Character.prototype.updateBitmap = function() {
    _Sprite_Character_updateBitmap.call(this);

    // Only care about the player character on maps
    if (this._character === $gamePlayer) {
      // If for any reason the engine set an empty name, override with fallback/trainer
      const g = trainerGraphic();
      const name  = this._characterName || "";
      const index = this._characterIndex ?? 0;

      if (!name || ImageManager.loadCharacter(name).isError()) {
        // Replace missing/errored bitmap with fallback/trainer graphic
        if (name !== g.name || index !== g.index) {
          this._characterName  = g.name;
          this._characterIndex = g.index;
          this.setCharacterBitmap(); // rebuilds bitmaps
        }
      }

      // Also force opacity/visibility at sprite level
      this.visible = true;
      this.opacity = 255;
      this.blendMode = 0;
    }
  };

  // When returning from battle, re-enforce
  const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
  Scene_Battle.prototype.terminate = function() {
    _Scene_Battle_terminate.call(this);
    if (SceneManager._scene instanceof Scene_Map) enforcePlayerData();
  };
})();
