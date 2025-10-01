/*:
 * @target MZ
 * @plugindesc Pokémon-style EXP growth curves (Fast/MediumFast/MediumSlow/Slow/Erratic/Fluctuating) with level cap. Uses Actor notetags. 
 * @author You
 * @help
 * Put this BELOW your other Fonary plugins.
 *
 * Usage (Actor Note):
 *   <SpeciesId: FLAMLET>
 *   <ExpCurve: MediumFast>   // Fast | MediumFast | MediumSlow | Slow | Erratic | Fluctuating
 *
 * If <ExpCurve> is missing but the actor has <SpeciesId>, DefaultCurve is used.
 * Actors WITHOUT <SpeciesId> and WITHOUT <ExpCurve> use the RPG Maker class EXP.
 *
 * @param DefaultCurve
 * @type select
 * @option Fast
 * @option MediumFast
 * @option MediumSlow
 * @option Slow
 * @option Erratic
 * @option Fluctuating
 * @default MediumFast
 *
 * @param LevelCap
 * @text Level Cap
 * @type number
 * @min 1
 * @max 200
 * @default 100
 *
 * @param ApplyOnlyToSpecies
 * @text Apply only if <SpeciesId> or <ExpCurve> present
 * @type boolean
 * @default true
 */

(() => {
  "use strict";

  const PN = "fonary_exp_curve_mz";
  const P  = PluginManager.parameters(PN);
  const DEFAULT_CURVE = String(P.DefaultCurve || "MediumFast");
  const LEVEL_CAP     = Number(P.LevelCap || 100);
  const ONLY_SPECIES  = String(P.ApplyOnlyToSpecies || "true") === "true";

  // ---------- helpers ----------
  function readTag(note, tag){
    const re = new RegExp("<"+tag+":\\s*([^>]+)\\s*>","i");
    const m = (note||"").match(re);
    return m ? String(m[1]).trim() : "";
  }
  function actorHasSpecies(a){
    const data = $dataActors[a?.actorId?.()||0];
    return !!(data && readTag(data.note, "SpeciesId"));
  }
  function actorCurve(a){
    const data = $dataActors[a?.actorId?.()||0];
    const tag = data ? readTag(data.note, "ExpCurve") : "";
    return (tag || (actorHasSpecies(a) ? DEFAULT_CURVE : ""));
  }
  function clampLevel(n){ return Math.max(1, Math.min(LEVEL_CAP, n|0)); }

  // ---------- Pokémon growth formulas (total exp to be AT level n) ----------
  function pow3(n){ return n*n*n; }

  function expFast(n){      // 0.8 * n^3
    return Math.floor(4 * pow3(n) / 5);
  }
  function expMediumFast(n){ // n^3
    return pow3(n);
  }
  function expMediumSlow(n){ // (6/5)n^3 - 15n^2 + 100n - 140
    const v = Math.floor((6*pow3(n))/5 - 15*n*n + 100*n - 140);
    return Math.max(0, v);
  }
  function expSlow(n){      // 1.25 * n^3
    return Math.floor(5 * pow3(n) / 4);
  }
  // Erratic (piecewise, Gen III+)
  function expErratic(n){
    if (n <= 50)  return Math.floor(pow3(n) * (100 - n) / 50);
    if (n <= 68)  return Math.floor(pow3(n) * (150 - n) / 100);
    if (n <= 98)  return Math.floor(pow3(n) * (Math.floor((1911 - 10*n)/3)) / 500);
    return Math.floor(pow3(n) * (160 - n) / 100); // 99..100
  }
  // Fluctuating (piecewise, Gen III+)
  function expFluctuating(n){
    if (n <= 15)  return Math.floor(pow3(n) * (Math.floor((n + 1)/3) + 24) / 50);
    if (n <= 36)  return Math.floor(pow3(n) * (n + 14) / 50);
    return Math.floor(pow3(n) * (Math.floor(n/2) + 32) / 50);
  }

  function totalExpFor(curveName, level){
    const n = clampLevel(level);
    if (n <= 1) return 0;
    const c = (curveName || "").toLowerCase();
    switch(c){
      case "fast":         return expFast(n);
      case "mediumfast":   return expMediumFast(n);
      case "medium fast":  return expMediumFast(n);
      case "mediumslow":   return expMediumSlow(n);
      case "medium slow":  return expMediumSlow(n);
      case "slow":         return expSlow(n);
      case "erratic":      return expErratic(n);
      case "fluctuating":  return expFluctuating(n);
      default:             return expMediumFast(n);
    }
  }

  // ---------- Override: use Pokémon curves for applicable actors ----------
  const _GA_expForLevel = Game_Actor.prototype.expForLevel;
  Game_Actor.prototype.expForLevel = function(level){
    const apply = (!ONLY_SPECIES) || actorHasSpecies(this) || actorCurve(this);
    if (apply){
      const curve = actorCurve(this);
      return totalExpFor(curve || DEFAULT_CURVE, level);
    }
    return _GA_expForLevel.call(this, level);
  };

  // Respect LevelCap for applicable actors
  const _GA_maxLevel = Game_Actor.prototype.maxLevel;
  Game_Actor.prototype.maxLevel = function(){
    const base = _GA_maxLevel.call(this);
    const apply = (!ONLY_SPECIES) || actorHasSpecies(this) || actorCurve(this);
    return apply ? Math.min(base, LEVEL_CAP) : base;
  };

})();
