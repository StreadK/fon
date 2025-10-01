/*:
 * @target MZ
 * @plugindesc Trainer battles (All-in-One): trainer & team via Troop Comments + Actor species. Auto-slots, 1v1 queue, per-member moves, prize, hard no-capture, and EXP-per-KO (trainer).
 * @author You
 * @help
 * TROOP COMMENT EXAMPLE
 * --------------------
 * Trainer: Youngster Tim, Prize: 600
 * Team: FLAMLET@5[moves=Ember, Charge], AQUAPUP@6
 *
 * ACTOR SPECIES (one Actor per species)
 * -------------------------------------
 * <SpeciesId: FLAMLET>
 * <EnemyBattler: Flamlet>   # img/enemies/Flamlet.png
 * <DefaultLevel: 5>         # optional fallback
 * <SpeciesName: Flamlet>    # optional display name
 * (Stats come from the Actor's Class curves at the chosen level.)
 *
 * MOVES (fallback if you omit [moves=...])
 * ----------------------------------------
 * Tag SKILLS like:
 *   <Learn: FLAMLET@5>
 *   <Learn: FLAMLET@12>
 * Enemies get the latest up to MaxMoves for their level.
 *
 * EXP PER KO (TRAINER)
 * --------------------
 * When an enemy faints in a trainer battle, EXP is awarded immediately.
 * End-of-battle EXP is auto-adjusted so nothing is double-paid.
 * Recipients are configurable (active only / alive battle members / whole party).
 *
 * HARD NO-CAPTURE
 * ---------------
 * Hides capture items/skills, blocks capture states, blocks capture plugin commands,
 * and refuses to add captured actors during trainer battles.
 *
 * @param PreventEscape
 * @text Prevent Escape (Trainer)
 * @type boolean
 * @default true
 *
 * @param NoCaptureSwitch
 * @text Switch ID: No Capture
 * @type switch
 * @default 0
 *
 * @param CaptureStates
 * @text Blocked Capture States (names or IDs)
 * @type string
 * @desc Comma-separated: e.g. Capture Target, 27. If empty, any state whose name contains "capture" is blocked.
 * @default Capture Target
 *
 * @param CaptureBlockedMsg
 * @text Message: Capture Blocked
 * @type string
 * @default You can’t capture a trainer’s fonary!
 *
 * @param MaxMoves
 * @text Max Moves (cap)
 * @type number
 * @min 1
 * @max 8
 * @default 4
 *
 * @param SendOutMsg
 * @text Message: Send Out
 * @type string
 * @default %1 sent out %2!
 *
 * @param PrizeMsg
 * @text Message: Prize
 * @type string
 * @default You got %1G from %2!
 *
 * @param PerKoExp
 * @text EXP per KO (Trainer)
 * @type boolean
 * @default true
 *
 * @param ExpRecipients
 * @text EXP Recipients
 * @type string
 * @desc active | alive | party  (Active battler only / Alive battle members / Whole party)
 * @default alive
 *
 * @param ShowExpMessages
 * @text Show EXP Messages
 * @type boolean
 * @default true
 *
 * @param ExpGainMsg
 * @text Message: EXP Gain
 * @type string
 * @default %1 gained %2 EXP!
 */
(() => {
  "use strict";
  const PN = "FonaryTrainerActors_MZ_AllInOne";
  const P  = PluginManager.parameters(PN);

  const PREVENT_ESCAPE     = String(P.PreventEscape || "true") === "true";
  const NO_CAPTURE_SWITCH  = Number(P.NoCaptureSwitch || 0);
  const CAPTURE_STATES_TXT = String(P.CaptureStates || "Capture Target");
  const CAPTURE_BLOCK_MSG  = String(P.CaptureBlockedMsg || "You can’t capture a trainer’s fonary!");
  const MAX_MOVES          = Math.max(1, Number(P.MaxMoves || 4));
  const MSG_SENDOUT        = String(P.SendOutMsg || "%1 sent out %2!");
  const MSG_PRIZE          = String(P.PrizeMsg   || "You got %1G from %2!");

  const PER_KO_EXP         = String(P.PerKoExp || "true") === "true";
  const EXP_RECIPIENTS     = String(P.ExpRecipients || "alive").toLowerCase(); // active|alive|party
  const SHOW_EXP_MSG       = String(P.ShowExpMessages || "true") === "true";
  const MSG_EXP_GAIN       = String(P.ExpGainMsg || "%1 gained %2 EXP!");

  const TrainerState = { active:false, name:"", prize:0 };

  // ---------------- comments / parsing ----------------
  function troopComments(troop){
    if (!troop || !troop.pages) return "";
    let text = "";
    for (const page of troop.pages){
      if (!page || !page.list) continue;
      for (const cmd of page.list){
        if (cmd.code === 108 || cmd.code === 408){
          text += (cmd.parameters && cmd.parameters[0] ? String(cmd.parameters[0]) : "") + "\n";
        }
      }
    }
    return text;
  }
  function parseTrainerHeader(txt){
    const m = /Trainer:\s*([^,\n]+)(?:,\s*Prize:\s*(\d+))?/i.exec(txt || "");
    if (!m) return null;
    return { name: String(m[1]).trim(), prize: (Number(m[2]||0)|0) };
  }
  function splitTeamTokens(raw){
    const tokens = []; let buf="", depth=0;
    for(let i=0;i<raw.length;i++){
      const ch=raw[i];
      if(ch==="[") depth++;
      if(ch==="]" && depth>0) depth--;
      if(ch==="," && depth===0){ tokens.push(buf); buf=""; continue; }
      buf+=ch;
    }
    if(buf.trim()) tokens.push(buf);
    return tokens;
  }
  // SPECIES[@LV][xN][[opts]], opts: moves=Ember, Charge
  function parseTeamExtended(txt){
    const m = /Team:\s*([^\n]+)/i.exec(txt || "");
    if (!m) return [];
    const out = [];
    for(const t0 of splitTeamTokens(m[1])){
      const t = String(t0).trim(); if (!t) continue;
      const mm = /^\s*([A-Za-z0-9_\-]+)(?:@(\d+))?(?:x(\d+))?(?:\[(.*)\])?\s*$/.exec(t);
      if (!mm) continue;
      const species = mm[1];
      const level   = mm[2] ? (Number(mm[2])|0) : 0;
      const count   = Math.max(1, Number(mm[3]||1));
      const optsTxt = mm[4] ? String(mm[4]) : "";
      const opts = {};
      if (optsTxt){
        for (const seg0 of optsTxt.split(";")){
          const seg = seg0.trim(); if (!seg) continue;
          const eq = seg.indexOf("=");
          if (eq>-1){ opts[seg.slice(0,eq).trim().toLowerCase()] = seg.slice(eq+1).trim(); }
          else opts[seg.toLowerCase()] = true;
        }
      }
      for(let i=0;i<count;i++) out.push({ species, level, opts });
    }
    return out;
  }

  // ---------------- actor/species helpers ----------------
  function actorIdBySpecies(species){
    const key = String(species||"").trim().toLowerCase();
    if (!key) return 0;
    for (let id=1; id<$dataActors.length; id++){
      const A=$dataActors[id]; if (!A) continue;
      const sid = String((A.meta?.SpeciesId)||A.meta?.speciesId||"").trim().toLowerCase();
      if (sid && sid===key) return id;
      if (!sid && String(A.name).trim().toLowerCase()===key) return id;
    }
    return 0;
  }
  function battlerNameFromActor(actorId){ return String($dataActors[actorId]?.meta?.EnemyBattler || "").trim(); }
  function defaultLevelFromActor(actorId){ const m=$dataActors[actorId]?.meta||{}; return Math.max(1, Number(m.DefaultLevel||m.Level||5)|0); }
  function speciesDisplayName(actorId){ const A=$dataActors[actorId]; const m=A?.meta||{}; return String(m.SpeciesName || A?.name || "???"); }
  function imagesFromActor(actorId){ const m=$dataActors[actorId]?.meta||{}; return {face:m.Face||null, sv:m.SVBattler||null, char:m.Character||null}; }
  function classParamAtLevel(classId, paramId, level){
    const cls=$dataClasses[classId]; const arr=cls?.params?.[paramId];
    const lv = Math.max(1, Math.min(level, (arr?.length||2)-1));
    return arr?.[lv] ?? 1;
  }

  // ---------------- moves helpers ----------------
  function findSkillIdByName(name){
    const t=String(name).trim().toLowerCase();
    for(let i=1;i<$dataSkills.length;i++){ const s=$dataSkills[i]; if(s && String(s.name).trim().toLowerCase()===t) return i; }
    return 0;
  }
  function parseMovesList(val){
    const out=[]; for(const tok0 of String(val||"").split(",")){
      const tok=String(tok0).trim(); if(!tok) continue;
      const n=Number(tok);
      if(!Number.isNaN(n) && $dataSkills[n]) out.push(n);
      else { const id=findSkillIdByName(tok); if(id) out.push(id); }
    }
    const uniq=[]; for(const id of out) if(!uniq.includes(id)) uniq.push(id);
    return uniq.slice(0, MAX_MOVES);
  }
  // <Learn: SPECIES@LEVEL>
  function skillsFromLearnTags(species, level){
    const safe=species.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const tag=new RegExp(`<Learn:\\s*${safe}\\s*@\\s*(\\d+)\\s*>`,"gi");
    const list=[];
    for(let id=1; id<$dataSkills.length; id++){
      const s=$dataSkills[id]; if(!s?.note) continue;
      let m; tag.lastIndex=0;
      while((m=tag.exec(s.note))!==null){ const lv=Number(m[1])|0; if(lv<=level) list.push({lv,id}); }
    }
    list.sort((a,b)=> a.lv-b.lv || a.id-b.id);
    const ids=[]; for(const e of list) if(!ids.includes(e.id)) ids.push(e.id);
    return ids.slice(-MAX_MOVES);
  }

  // ---------------- auto-slot injection ----------------
  function firstValidEnemyId(){ for(let id=1; id<$dataEnemies.length; id++){ if($dataEnemies[id]) return id; } return 1; }
  function ensureTroopHasSlots(troop, count){
    troop.members ||= [];
    const need=Math.max(1,count)-troop.members.length;
    if(need<=0) return;
    const base=firstValidEnemyId();
    const baseX=560, baseY=280, dx=-40, dy=40;
    const start=troop.members.length;
    for(let i=0;i<need;i++){
      const idx=start+i, col=idx%3, row=Math.floor(idx/3);
      troop.members.push({ enemyId: base, x: baseX+dx*col, y: baseY+dy*row, hidden:false });
    }
  }

  // ---------------- apply team & moves ----------------
  function applyActorTeamToTroop(team){
    const members=$gameTroop.members(); const n=Math.min(team.length, members.length);
    for(let i=0;i<n;i++){
      const entry=team[i], gEnemy=members[i]; if(!gEnemy) continue;
      const actorId=actorIdBySpecies(entry.species);
      if(!actorId){ console.warn(`[Trainer] Species not found (Actor): ${entry.species}`); continue; }
      gEnemy._fonaryActorTemplateId=actorId;
      gEnemy._fonarySpeciesOverride=String(entry.species);
      gEnemy._fonaryLevelOverride= entry.level>0 ? entry.level : defaultLevelFromActor(actorId);
      gEnemy._fonaryEnemyBattlerOverride=battlerNameFromActor(actorId);
      gEnemy._fonaryOverrideName=speciesDisplayName(actorId);
      gEnemy._fonaryImagesOverride=imagesFromActor(actorId);
      let moves=[];
      if(entry.opts?.moves) moves=parseMovesList(entry.opts.moves);
      if(!moves.length) moves=skillsFromLearnTags(gEnemy._fonarySpeciesOverride, gEnemy._fonaryLevelOverride);
      gEnemy._fonaryMovesOverride = moves.filter(id=>id>0 && $dataSkills[id]);
      gEnemy.recoverAll(); gEnemy.refresh();
    }
    for(let i=0;i<members.length;i++){ const e=members[i]; if(!e) continue; if(i===0) e.appear(); else e.hide(); }
    announceSendOut(members[0]);
  }
  function speciesNameOfEnemy(enemy){ return enemy?._fonaryOverrideName || enemy?.name() || "?"; }
  function announceSendOut(enemy){ if(!enemy) return; $gameMessage.add(MSG_SENDOUT.replace("%1", TrainerState.name||"Trainer").replace("%2", speciesNameOfEnemy(enemy))); }

  // ---------------- capture state set ----------------
  const BlockedCaptureStates=new Set();
  function buildCaptureStateSet(){
    const raw=String(CAPTURE_STATES_TXT||"").split(",");
    for(let token of raw){
      token=String(token).trim();
      if(!token) continue;
      const id=Number(token);
      if(!Number.isNaN(id) && $dataStates[id]){ BlockedCaptureStates.add(id); continue; }
      const low=token.toLowerCase();
      for(let i=1;i<$dataStates.length;i++){ const st=$dataStates[i]; if(st && String(st.name).trim().toLowerCase()===low){ BlockedCaptureStates.add(i); break; } }
    }
  }
  const _DM_onLoad=DataManager.onLoad;
  DataManager.onLoad=function(object){ _DM_onLoad.call(this, object); if(object===$dataStates) buildCaptureStateSet(); };

  // ---------------- setup/start/queue hooks ----------------
  const _BM_setup=BattleManager.setup;
  BattleManager.setup=function(troopId, canEscape, canLose){
    const troop=$dataTroops[troopId]; const txt=troopComments(troop);
    const head=parseTrainerHeader(txt); const team=parseTeamExtended(txt);
    if(head && team.length>0) ensureTroopHasSlots(troop, team.length);
    _BM_setup.call(this, troopId, canEscape, canLose);
    if(head){
      TrainerState.active=true; TrainerState.name=head.name; TrainerState.prize=head.prize|0;
      if(PREVENT_ESCAPE) this._canEscape=false;
      if(NO_CAPTURE_SWITCH>0) $gameSwitches.setValue(NO_CAPTURE_SWITCH,true);
      this._fonaryTrainerTeamParsed=team;
    }else{
      TrainerState.active=false; TrainerState.name=""; TrainerState.prize=0;
      if(NO_CAPTURE_SWITCH>0) $gameSwitches.setValue(NO_CAPTURE_SWITCH,false);
      this._fonaryTrainerTeamParsed=[];
    }
  };
  const _SB_start=Scene_Battle.prototype.start;
  Scene_Battle.prototype.start=function(){
    _SB_start.call(this);
    if(!TrainerState.active) return;
    const team=BattleManager._fonaryTrainerTeamParsed||[];
    if(team.length>0) applyActorTeamToTroop(team);
    else{
      const members=$gameTroop.members(); for(let i=0;i<members.length;i++){ const e=members[i]; if(!e) continue; if(i===0) e.appear(); else e.hide(); }
      announceSendOut(members[0]);
    }
  };

  // ===================== EXP PER KO (TRAINER) ===============================
  function expRecipients(){
    if (EXP_RECIPIENTS === "active"){
      const s = BattleManager._subject;
      if (s && s.isActor()) return [s];
      // fallback to alive battle member(s)
      return $gameParty.aliveMembers();
    } else if (EXP_RECIPIENTS === "party"){
      return $gameParty.members();
    } else {
      return $gameParty.aliveMembers(); // default
    }
  }
  function giveKoExpFor(enemy){
    if (!PER_KO_EXP || !TrainerState.active) return;
    if (enemy._expPaid) return;
    const exp = Math.max(0, enemy.exp?.() ?? 0);
    if (exp <= 0){ enemy._expPaid = true; return; }
    const rec = expRecipients();
    for (const a of rec){ if (a && a.isActor) a.gainExp(exp); }
    if (SHOW_EXP_MSG){
      for (const a of rec){
        const msg = MSG_EXP_GAIN.replace("%1", a.name()).replace("%2", String(exp));
        $gameMessage.add(msg);
      }
    }
    enemy._expPaid = true;
  }

  // On KO: award EXP now, then reveal next hidden
  const _GE_die=Game_Enemy.prototype.die;
  Game_Enemy.prototype.die=function(){
    _GE_die.call(this);
    if (TrainerState.active){
      giveKoExpFor(this);
      const next=$gameTroop.members().find(e=>e&&e.isHidden());
      if(next){ next.appear(); announceSendOut(next); }
    }
  };

  // Prevent double EXP at victory: if we've paid per-KO, make this enemy worth 0 later
  const _GE_exp = Game_Enemy.prototype.exp;
  Game_Enemy.prototype.exp = function(){
    const base = _GE_exp.call(this);
    if (TrainerState.active && this._expPaid) return 0;
    return base;
  };

  // ---------------- enemy overrides (name/battler/stats) ----------------
  const _GE_name=Game_Enemy.prototype.name;
  Game_Enemy.prototype.name=function(){ if(this._fonaryOverrideName) return this._fonaryOverrideName; return _GE_name.call(this); };
  const _GE_battlerName=Game_Enemy.prototype.battlerName;
  Game_Enemy.prototype.battlerName=function(){ if(this._fonaryEnemyBattlerOverride) return this._fonaryEnemyBattlerOverride; return _GE_battlerName.call(this); };
  const _GE_paramBase=Game_Enemy.prototype.paramBase;
  Game_Enemy.prototype.paramBase=function(paramId){
    if(this._fonaryActorTemplateId){
      const A=$dataActors[this._fonaryActorTemplateId];
      if(A){ const lv=this._fonaryLevelOverride||1; return classParamAtLevel(A.classId, paramId, lv); }
    }
    return _GE_paramBase.call(this, paramId);
  };

  // ---------------- enemy AI moves (use our pool if present) ----------------
  const _GE_makeActions=Game_Enemy.prototype.makeActions;
  Game_Enemy.prototype.makeActions=function(){
    Game_Battler.prototype.makeActions.call(this);
    const count=this.numActions(); this._actions=[];
    const pool=Array.isArray(this._fonaryMovesOverride)?this._fonaryMovesOverride.slice():[];
    if(!pool.length){ _GE_makeActions.call(this); return; }
    for(let i=0;i<count;i++){
      const action=new Game_Action(this);
      let picked=0;
      for(let tries=0; tries<pool.length*2; tries++){
        const sid=pool[Math.floor(Math.random()*pool.length)], item=$dataSkills[sid];
        if(item && this.meetsSkillConditions(item)){ picked=sid; break; }
      }
      if(!picked) picked=1; // Attack
      action.setSkill(picked); this._actions.push(action);
    }
  };

  // ---------------- prize & cleanup ----------------
  const _BM_processVictory=BattleManager.processVictory;
  BattleManager.processVictory=function(){
    if(TrainerState.active && TrainerState.prize>0){
      $gameParty.gainGold(TrainerState.prize);
      $gameMessage.add(MSG_PRIZE.replace("%1", String(TrainerState.prize)).replace("%2", TrainerState.name||"Trainer"));
    }
    const r=_BM_processVictory.call(this);
    TrainerState.active=false; TrainerState.name=""; TrainerState.prize=0;
    if(NO_CAPTURE_SWITCH>0) $gameSwitches.setValue(NO_CAPTURE_SWITCH,false);
    return r;
  };
  const _BM_processDefeat=BattleManager.processDefeat;
  BattleManager.processDefeat=function(){ const r=_BM_processDefeat.call(this); TrainerState.active=false; TrainerState.name=""; TrainerState.prize=0; if(NO_CAPTURE_SWITCH>0) $gameSwitches.setValue(NO_CAPTURE_SWITCH,false); return r; };

  // ===========================================================================
  // HARD NO-CAPTURE LAYERS
  // ===========================================================================

  function isCaptureItemOrSkill(obj){
    if(!obj || !obj.effects) return false;
    const ADD_STATE = (Game_Action.EFFECT_ADD_STATE ?? 21);
    for(const eff of obj.effects){
      if(!eff) continue;
      if(eff.code === ADD_STATE){
        const st = $dataStates[eff.dataId];
        if (BlockedCaptureStates.size){
          if (BlockedCaptureStates.has(Number(eff.dataId))) return true;
        } else if (st && String(st.name).toLowerCase().includes("capture")){
          return true;
        }
      }
    }
    return false;
  }

  // 1) Hide capture ITEMS
  const _WBI_includes=Window_BattleItem.prototype.includes;
  Window_BattleItem.prototype.includes=function(item){
    if (TrainerState.active && isCaptureItemOrSkill(item)) return false;
    return _WBI_includes.call(this, item);
  };
  // 1b) Hide capture SKILLS
  const _WBS_includes = Window_BattleSkill.prototype.includes;
  Window_BattleSkill.prototype.includes = function(item){
    if (TrainerState.active && isCaptureItemOrSkill(item)) return false;
    return _WBS_includes.call(this, item);
  };

  // 2) Block Add State (items/skills) at action layer
  const _GA_itemEffectAddState = Game_Action.prototype.itemEffectAddState;
  Game_Action.prototype.itemEffectAddState = function(target, effect){
    if (TrainerState.active && target.isEnemy()){
      const ADD_STATE = (Game_Action.EFFECT_ADD_STATE ?? 21);
      if (effect && effect.code === ADD_STATE){
        const stId = Number(effect.dataId);
        const st = $dataStates[stId];
        const nameHasCapture = st && String(st.name).toLowerCase().includes("capture");
        if (BlockedCaptureStates.has(stId) || (!BlockedCaptureStates.size && nameHasCapture)){
          if (CAPTURE_BLOCK_MSG){ $gameMessage.add(CAPTURE_BLOCK_MSG); if (SoundManager.playBuzzer) SoundManager.playBuzzer(); }
          return;
        }
      }
    }
    _GA_itemEffectAddState.call(this, target, effect);
  };

  // 3) Intercept capture plugin commands
  const _PM_callCommand=PluginManager.callCommand;
  PluginManager.callCommand=function(interpreter, pluginName, commandName, args){
    if (TrainerState.active){
      const p=String(pluginName||""); const c=String(commandName||"");
      if (/capture/i.test(p) || /capture/i.test(c)){
        if (CAPTURE_BLOCK_MSG){ $gameMessage.add(CAPTURE_BLOCK_MSG); if (SoundManager.playBuzzer) SoundManager.playBuzzer(); }
        return;
      }
    }
    _PM_callCommand.call(this, interpreter, pluginName, commandName, args);
  };

  // 4) Final guard: refuse adding captured actors to party mid trainer battle
  const _GP_addActor=Game_Party.prototype.addActor;
  Game_Party.prototype.addActor=function(actorId){
    if (TrainerState.active && this.inBattle && this.inBattle()){
      const a=$gameActors.actor(actorId);
      if (a && a._fonary){
        if (CAPTURE_BLOCK_MSG){ $gameMessage.add(CAPTURE_BLOCK_MSG); if (SoundManager.playBuzzer) SoundManager.playBuzzer(); }
        return;
      }
    }
    _GP_addActor.call(this, actorId);
  };

})();
