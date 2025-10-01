/*:
 * @target MZ
 * @plugindesc Fonary Stat & Damage Scaling (Pokémon-like): base stats per species + IV/EV (optional) + HP/Atk/Def/SpA/SpD/Spe formulas + optional Pokémon-like damage using <Power>.
 * @author You
 * @help
 * GOAL
 * ----
 * Keep numbers small like Pokémon. This plugin replaces how stats are
 * calculated for your Fonaries and (optionally) uses a Pokémon-like
 * damage formula for skills that define a <Power: N> notetag.
 *
 * HOW TO SET BASE STATS
 * ---------------------
 * In the *Actor* note of each species actor (the one used when captured):
 *   <SpeciesId: FLAMLET>
 *   <BaseStats: HP,ATK,DEF,SPA,SPD,SPE>
 *   <Types: Fire, Normal>   # optional, used for STAB in damage
 *
 * Example:
 *   <SpeciesId: FLAMLET>
 *   <BaseStats: 39,52,43,60,50,65>
 *   <Types: Fire>
 *
 * ENEMIES
 * -------
 * For wild/trainer enemies, set <SpeciesId: ...> on the Enemy. The plugin
 * will look up the species' base stats from the Actor with the same SpeciesId.
 * If you also set this on the Game_Enemy at runtime (e.g., _fonarySpeciesId
 * or enemy name equals species), those will be used too.
 *
 * IV / EV (optional)
 * ------------------
 * By default, IV/EV are disabled for simplicity (all 0). You can enable IVs to
 * randomize per actor on first use. EVs are kept 0 unless you handle them in
 * another plugin—this plugin exposes accessors so you can set actor._evs.
 *
 * DAMAGE (optional)
 * -----------------
 * If a Skill note contains <Power: N>, the damage is computed using a very
 * close Pokémon-style formula using A/D from your scaled stats and N as power.
 * Hit Type determines category:
 *   - Physical (Hit Type = Physical) → uses ATK vs DEF
 *   - Magical  (Hit Type = Magical)  → uses SPA vs SPD
 * STAB is 1.5x if the skill's <Type: X> matches one of the user's <Types: ...>.
 * If a skill has no <Power>, the engine's original damage formula is used.
 *
 * ORDER
 * -----
 * Place BELOW your capture / learnset / moves / HUD plugins but ABOVE anything that
 * hard-overrides paramBase or makeDamageValue.
 *
 * @param LevelCap
 * @type number
 * @min 1
 * @max 200
 * @default 100
 *
 * @param UseIVs
 * @text Use IVs (0..31)
 * @type boolean
 * @default false
 *
 * @param RandomIVMin
 * @type number
 * @min 0
 * @max 31
 * @default 10
 *
 * @param RandomIVMax
 * @type number
 * @min 0
 * @max 31
 * @default 31
 *
 * @param UsePokemonDamage
 * @text Use Pokémon-like Damage if <Power> present
 * @type boolean
 * @default true
 *
 * @param DefaultPower
 * @text Default Power if <Power> missing (leave 0 to skip)
 * @type number
 * @min 0
 * @default 0
 *
 * @param STAB
 * @text STAB Multiplier
 * @type number
 * @decimals 2
 * @default 1.5
 *
 * @param MinDamage
 * @text Minimum Damage (after calc)
 * @type number
 * @min 0
 * @default 1
 */
(function(){
  'use strict';

  const PN = "fonary_stats_scaling_mz";
  const P  = PluginManager.parameters(PN);
  const LEVEL_CAP = Number(P.LevelCap||100);
  const USE_IVS   = String(P.UseIVs||"false")==="true";
  const IV_MIN    = Math.max(0, Math.min(31, Number(P.RandomIVMin||10)));
  const IV_MAX    = Math.max(0, Math.min(31, Number(P.RandomIVMax||31)));
  const USE_POKE_DMG = String(P.UsePokemonDamage||"true")==="true";
  const DEFAULT_POWER = Math.max(0, Number(P.DefaultPower||0));
  const STAB = Number(P.STAB||1.5);
  const MIN_DMG = Math.max(0, Number(P.MinDamage||1));

  // ---- Notetag parsing helpers ----
  function readTag(note, tag){
    const re = new RegExp("<"+tag+":\\s*([^>]+?)\\s*>","i");
    const m = (note||"").match(re);
    return m ? m[1].trim() : "";
  }
  function readListTag(note, tag){
    const s = readTag(note, tag);
    if (!s) return [];
    return s.split(",").map(t=>t.trim()).filter(Boolean);
  }

  // ---- Species base stats map from ACTORS ----
  // speciesId -> {hp,atk,def,spa,spd,spe, types:[]}
  const SPECIES = {};

  function parseSpeciesFromActors(){
    if (!$dataActors) return;
    for (let i=1;i<$dataActors.length;i++){
      const a = $dataActors[i];
      if (!a || !a.note) continue;
      const sid = readTag(a.note, "SpeciesId");
      if (!sid) continue;
      const bs  = readTag(a.note, "BaseStats");
      if (!bs) continue;
      const nums = bs.split(",").map(s=>Number(s.trim()||0));
      const obj = {
        hp: nums[0]|0, atk: nums[1]|0, def: nums[2]|0,
        spa: nums[3]|0, spd: nums[4]|0, spe: nums[5]|0,
        types: readListTag(a.note,"Types")
      };
      SPECIES[String(sid)] = obj;
    }
  }

  const _DM_onLoad = DataManager.onLoad;
  DataManager.onLoad = function(object){
    _DM_onLoad.call(this, object);
    if (object === $dataActors) parseSpeciesFromActors();
  };

  // ---- Utility: get species id for actor/enemy ----
  function speciesIdOfActor(actor){
    if (actor && actor._fonary && actor._fonary.speciesId) return String(actor._fonary.speciesId);
    const data = $dataActors[actor?.actorId?.()||0];
    const sid = data ? readTag(data.note,"SpeciesId") : "";
    return sid ? String(sid) : "";
  }
  function speciesIdOfEnemy(enemy){
    const obj = enemy?.enemy?.() || null;
    let sid = obj ? readTag(obj.note,"SpeciesId") : "";
    if (!sid && enemy && enemy._fonarySpeciesId) sid = String(enemy._fonarySpeciesId);
    if (!sid && enemy && enemy.name) sid = enemy.name();
    return String(sid||"");
  }

  function speciesDataById(sid){ return SPECIES[String(sid)] || null; }

  // ---- IV / EV store on actors ----
  function ensureIVs(actor){
    if (!USE_IVS) return {hp:0,atk:0,def:0,spa:0,spd:0,spe:0};
    actor._fonIvs = actor._fonIvs || {};
    const keys = ["hp","atk","def","spa","spd","spe"];
    for (const k of keys){
      if (actor._fonIvs[k]==null){
        actor._fonIvs[k] = Math.floor(Math.random()*(IV_MAX-IV_MIN+1))+IV_MIN;
      }
    }
    return actor._fonIvs;
  }
  function getEVs(actor){
    actor._fonEvs = actor._fonEvs || {hp:0,atk:0,def:0,spa:0,spd:0,spe:0};
    return actor._fonEvs; // you can modify this from other systems
  }

  // ---- Core stat formulas (Pokémon-like, Gen3+) ----
  function statHP(base, iv, ev, lv){
    // HP = floor(((2*base + iv + floor(ev/4)) * lv)/100) + lv + 10
    return Math.floor(((2*base + iv + Math.floor(ev/4)) * lv)/100) + lv + 10;
  }
  function statOther(base, iv, ev, lv){
    // Stat = floor(((2*base + iv + floor(ev/4)) * lv)/100) + 5
    return Math.floor(((2*base + iv + Math.floor(ev/4)) * lv)/100) + 5;
  }

  // mapping: paramId -> which stat to return
  function computeFonaryParamForActor(actor, paramId){
    const sid = speciesIdOfActor(actor);
    const sp  = speciesDataById(sid);
    if (!sp) return null; // not a fonary
    const lv = Math.max(1, Math.min(LEVEL_CAP, actor.level));
    const ivs = ensureIVs(actor);
    const evs = getEVs(actor);

    switch(paramId){
      case 0: return statHP (sp.hp , ivs.hp , evs.hp , lv); // mhp
      case 1: return 0;                                     // mmp -> PP system used, keep 0
      case 2: return statOther(sp.atk, ivs.atk, evs.atk, lv); // atk
      case 3: return statOther(sp.def, ivs.def, evs.def, lv); // def
      case 4: return statOther(sp.spa, ivs.spa, evs.spa, lv); // mat (SpAtk)
      case 5: return statOther(sp.spd, ivs.spd, evs.spd, lv); // mdf (SpDef)
      case 6: return statOther(sp.spe, ivs.spe, evs.spe, lv); // agi (Speed)
      case 7: return 0;                                     // luk unused
      default: return null;
    }
  }

  function computeFonaryParamForEnemy(enemy, paramId){
    const sid = speciesIdOfEnemy(enemy);
    const sp  = speciesDataById(sid);
    if (!sp) return null;
    const lv = Math.max(1, Math.min(LEVEL_CAP, enemy.level ? enemy.level : (enemy._fonaryLevelOverride||1)));
    // enemies use neutral IV/EV
    const iv=0, ev=0;
    switch(paramId){
      case 0: return statHP (sp.hp , iv, ev, lv);
      case 1: return 0;
      case 2: return statOther(sp.atk, iv, ev, lv);
      case 3: return statOther(sp.def, iv, ev, lv);
      case 4: return statOther(sp.spa, iv, ev, lv);
      case 5: return statOther(sp.spd, iv, ev, lv);
      case 6: return statOther(sp.spe, iv, ev, lv);
      case 7: return 0;
      default: return null;
    }
  }

  // ---- Override paramBase for Actors/Enemies when species is known ----
  const _GA_paramBase = Game_Actor.prototype.paramBase;
  Game_Actor.prototype.paramBase = function(paramId){
    const v = computeFonaryParamForActor(this, paramId);
    if (v != null) return v;
    return _GA_paramBase.call(this, paramId);
  };

  const _GE_paramBase = Game_Enemy.prototype.paramBase;
  Game_Enemy.prototype.paramBase = function(paramId){
    const v = computeFonaryParamForEnemy(this, paramId);
    if (v != null) return v;
    return _GE_paramBase.call(this, paramId);
  };

  // ---- Pokémon-like Damage when a skill defines <Power: N> ----
  function skillPower(skill){
    const s = skill;
    if (!s) return 0;
    let m = /<Power:\s*(\d+)\s*>/i.exec(s.note||"");
    if (m) return Number(m[1])|0;
    return DEFAULT_POWER|0;
  }
  function skillTypeTag(skill){
    const m = /<Type:\s*([^>]+)\s*>/i.exec(skill?.note||"");
    return m ? m[1].trim() : "";
  }
  function actorTypes(actor){
    const sid = speciesIdOfActor(actor);
    const sp  = speciesDataById(sid);
    return sp ? (sp.types||[]) : [];
  }

  const _GA_makeDamageValue = Game_Action.prototype.makeDamageValue;
  Game_Action.prototype.makeDamageValue = function(target, critical){
    const item = this.item();
    if (!USE_POKE_DMG || !item || DataManager.isItem(item)) {
      return _GA_makeDamageValue.call(this, target, critical);
    }
    const pow = skillPower(item);
    if (pow <= 0) {
      return _GA_makeDamageValue.call(this, target, critical);
    }

    // Determine category via hit type (2=physical, 3=magical)
    const user = this.subject();
    const hitType = item.hitType || 0;
    const level = user.level || 1;

    let A, D;
    if (hitType === 3) { // magical = special
      A = user.param(4); // mat
      D = target.param(5); // mdf
    } else { // physical
      A = user.param(2); // atk
      D = target.param(3); // def
    }
    D = Math.max(1, D);

    // Base damage (simplified Pokémon formula)
    let dmg = Math.floor( Math.floor( ((2*level/5 + 2) * pow * A / D) / 50 ) + 2 );

    // STAB
    const typeName = skillTypeTag(item);
    if (typeName) {
      const userTypes = user.isActor() ? actorTypes(user) : [];
      if (userTypes.includes(typeName)) {
        dmg = Math.floor(dmg * STAB);
      }
    }

    // Critical (engine still flags critical; apply 1.5x)
    if (critical) dmg = Math.floor(dmg * 1.5);

    // Guard
    if (target.isGuard && target.isGuard()) dmg = Math.floor(dmg / 2);

    // Minimum damage if it hits
    dmg = Math.max(MIN_DMG, dmg);

    // Respect recover-type skills if any
    if (this.isHpRecover && this.isHpRecover()) dmg = -dmg;

    return dmg;
  };

})();
