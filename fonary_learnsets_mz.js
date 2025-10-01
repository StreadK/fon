/*:
 * @target MZ
 * @plugindesc Fonary learn system (one-file): central guard on learnSkill (no battle learning, no auto-replace), map-only prompts, remembers "Do not learn". Supports Actor <Learnset> + Skill <Learn: SPECIES@LEVEL>.
 * @author You
 * @help
 * HOW TO DEFINE LEARNS
 * A) On species ACTOR (recommended):
 *    <SpeciesId: FLAMLET>
 *    <Learnset>
 *    5: Ember
 *    8: Quick Attack
 *    12: Flame Charge
 *    </Learnset>
 *    (Right side can be Skill NAME or ID.)
 *
 * B) On SKILL (also supported):
 *    <Learn: FLAMLET@5>
 *    <Learn: FLAMLET@12>
 *
 * WHAT THIS PLUGIN GUARANTEES FOR FONARIES
 * - No learning in battle (ever). All attempts are queued for the map.
 * - If moves are full (>= MaxMoves), it never auto-forgets: it opens a replace
 *   prompt on the MAP so you choose (and "Do not learn" is respected).
 * - Any other plugin (or vanilla class) trying to learn a move goes through
 *   this wrapper too, so it cannot force a replacement.
 * - Sanitizes move lists (no blank/invisible skills).
 *
 * ORDER: Put this plugin LAST, below EXP/trainer/HUD.
 *
 * @param MaxMoves
 * @type number
 * @min 1
 * @max 8
 * @default 4
 *
 * @param LearnMsg
 * @text Message: Learned
 * @type string
 * @default %1 learned %2!
 *
 * @param ReplacePrompt
 * @text Message: Replace Prompt
 * @type string
 * @default %1 wants to learn %2, but already knows %3 moves. Choose a move to forget:
 *
 * @param DontLearnText
 * @text Menu: Don't learn
 * @type string
 * @default Do not learn
 *
 * @param ScanInterval
 * @text Map Scan Interval (frames)
 * @type number
 * @min 5
 * @max 120
 * @default 20
 *
 * @command ClearDeclined
 * @text Clear Declined Learn(s)
 * @arg actorId
 * @type actor
 * @default 0
 * @arg skillId
 * @type skill
 * @default 0
 */

(() => {
  "use strict";

  const PN = "FonaryLearnsets_MZ";
  const P  = PluginManager.parameters(PN);

  const MAX_MOVES     = Math.max(1, Number(P.MaxMoves || 4));
  const MSG_LEARNED   = String(P.LearnMsg || "%1 learned %2!");
  const MSG_REPLACE   = String(P.ReplacePrompt || "%1 wants to learn %2, but already knows %3 moves. Choose a move to forget:");
  const TXT_SKIP      = (String(P.DontLearnText || "Do not learn").trim() || "Do not learn");
  const SCAN_INTERVAL = Math.max(5, Number(P.ScanInterval || 20));

  // ---------------- core helpers ----------------
  const inBattle = () => !!($gameParty && $gameParty.inBattle && $gameParty.inBattle());
  const gameBusy = () => !!($gameMessage && $gameMessage.isBusy && $gameMessage.isBusy());

  function readTag(note, key){
    const m = (note||"").match(new RegExp("<"+key+":\\s*([^>]+)\\s*>","i"));
    return m ? String(m[1]).trim() : "";
  }

  function isFonaryActor(a){
    if (!a) return false;
    if (a._fonary && a._fonary.speciesId) return true;
    const id = a._actorId || (a.actorId && a.actorId()) || 0;
    const db = $dataActors[id];
    return !!(db && /<SpeciesId:\s*[^>]+>/i.test(String(db?.note||"")));
  }

  // ------------- learnset store (merged) -------------
  const LEARNSETS = {}; // { speciesId: [{ level, skillId }, ...] }
  let _skillsReady = false, _actorsReady = false, _skillNameToId = Object.create(null);

  function indexSkillsByName(){
    _skillNameToId = Object.create(null);
    for (let id=1; id<$dataSkills.length; id++){
      const sk = $dataSkills[id];
      if (!sk || !sk.name) continue;
      const key = String(sk.name).trim().toLowerCase();
      if (!_skillNameToId[key]) _skillNameToId[key] = id;
    }
  }
  function addLearn(species, level, sid){
    if (!species || !level || !sid) return;
    if (!$dataSkills[sid]) return;
    (LEARNSETS[species] ||= []).push({ level: level|0, skillId: sid });
  }
  function parseFromSkills(){
    const rx = /<Learn:\s*([A-Za-z0-9_\-]+)\s*@\s*(\d+)\s*>/gi;
    for (let id=1; id<$dataSkills.length; id++){
      const sk = $dataSkills[id];
      if (!sk || !sk.note) continue;
      rx.lastIndex = 0; let m;
      while ((m = rx.exec(sk.note)) !== null){
        addLearn(String(m[1]).trim(), Number(m[2])|0, id);
      }
    }
  }
  function parseFromActors(){
    for (let aid=1; aid<$dataActors.length; aid++){
      const a = $dataActors[aid]; if (!a) continue;
      const species = readTag(a.note, "SpeciesId"); if (!species) continue;

      // <Learnset> block
      const blk = /<Learnset>([\s\S]*?)<\/Learnset>/i.exec(a.note||"");
      if (blk && blk[1]){
        const lines = blk[1].split(/\r?\n/);
        for (const raw of lines){
          const line = String(raw||"").trim(); if (!line) continue;
          const m = /^(\d+)\s*:\s*(.+)$/.exec(line); if (!m) continue;
          const level = Number(m[1])|0; const rhs = String(m[2]).trim();
          let sid = 0;
          if (/^\d+$/.test(rhs)) sid = Number(rhs)|0; else sid = _skillNameToId[rhs.toLowerCase()] || 0;
          if (sid>0) addLearn(species, level, sid);
        }
      }
      // Optional inline <LearnAt: L, NameOrId>
      const rx2 = /<LearnAt:\s*(\d+)\s*,\s*([^>]+)\s*>/gi; let m2;
      while ((m2 = rx2.exec(a.note||"")) !== null){
        const level = Number(m2[1])|0; const rhs = String(m2[2]).trim();
        let sid = 0; if (/^\d+$/.test(rhs)) sid = Number(rhs)|0; else sid = _skillNameToId[rhs.toLowerCase()] || 0;
        if (sid>0) addLearn(species, level, sid);
      }
    }
  }
  function finalizeLearnsets(){
    for (const sp in LEARNSETS){
      const arr = LEARNSETS[sp];
      arr.sort((a,b)=> (a.level-b.level) || (a.skillId-b.skillId));
      const out = []; let pl=-1, ps=-1;
      for (const e of arr){ if (e.level===pl && e.skillId===ps) continue; out.push(e); pl=e.level; ps=e.skillId; }
      LEARNSETS[sp] = out;
    }
  }

  const _DM_onLoad = DataManager.onLoad;
  DataManager.onLoad = function(obj){
    _DM_onLoad.call(this, obj);
    if (obj === $dataSkills) _skillsReady = true;
    if (obj === $dataActors) _actorsReady = true;
    if (_skillsReady && _actorsReady){
      indexSkillsByName();
      for (const k in LEARNSETS) delete LEARNSETS[k];
      parseFromSkills();
      parseFromActors();
      finalizeLearnsets();
    }
  };

  // ------------- actor helpers + sanitize -------------
  function speciesIdOf(a){
    if (a && a._fonary && a._fonary.speciesId) return String(a._fonary.speciesId);
    const db = $dataActors[a?._actorId || a?.actorId?.() || 0];
    const sid = readTag(db?db.note:"","SpeciesId");
    return sid ? String(sid) : "";
  }
  function learnsetFor(a){ return LEARNSETS[speciesIdOf(a)] || []; }

  function sanitizeActorSkills(a){
    if (!a) return;
    const seen = Object.create(null); const out = [];
    const src = a._skills || [];
    for (const id of src){
      if (!id || id<=0) continue;
      const sk = $dataSkills[id]; if (!sk) continue;
      const nm = String(sk.name||"").trim(); if (!nm) continue;
      if (seen[id]) continue; seen[id]=1; out.push(id);
    }
    a._skills = out;
  }
  function validSkills(a){
    sanitizeActorSkills(a);
    return (a._skills||[]).map(id=>$dataSkills[id]).filter(Boolean);
  }
  function knows(a, sid){
    sanitizeActorSkills(a);
    return (a._skills||[]).includes(sid);
  }

  // ------------- decline memory (respect "Do not learn") -------------
  function markDeclined(a, sid){ a._fonDeclined ||= {}; a._fonDeclined[sid] = true; }
  function isDeclined(a, sid){ return !!(a && a._fonDeclined && a._fonDeclined[sid]); }
  PluginManager.registerCommand(PN, "ClearDeclined", args=>{
    const aid = Number(args.actorId||0); const sid = Number(args.skillId||0);
    const a = $gameActors.actor(aid); if (!a || !a._fonDeclined) return;
    if (sid>0) delete a._fonDeclined[sid]; else a._fonDeclined = {};
  });

  // ------------- prompt queue (map only, dedup) -------------
  function qKey(aid,sid){ return `${aid}:${sid}`; }
  function qPushUnique(aid,sid){
    const sys = $gameSystem; sys._fonLearnQueue ||= []; sys._fonLearnQSet ||= {};
    const k = qKey(aid,sid);
    if (!sys._fonLearnQSet[k]){ sys._fonLearnQueue.push({actorId:aid, skillId:sid}); sys._fonLearnQSet[k]=true; }
  }
  function qShift(){
    const sys = $gameSystem; const q = sys._fonLearnQueue||[]; const it = q.length? q.shift(): null;
    if (it && sys._fonLearnQSet) delete sys._fonLearnQSet[qKey(it.actorId,it.skillId)];
    return it;
  }
  function qHas(){ return !!(($gameSystem._fonLearnQueue||[]).length); }

  function presentNextQueued(){
    if (inBattle()) return;
    if ($gameTemp && $gameTemp._fonLearnPromptOpen) return;

    const it = qShift(); if (!it) return;
    const a = $gameActors.actor(it.actorId); if (!a) return;

    if (isDeclined(a, it.skillId)) { if (qHas() && !gameBusy()) presentNextQueued(); return; }
    if (knows(a, it.skillId))     { if (qHas() && !gameBusy()) presentNextQueued(); return; }

    // If room opened up, learn immediately on map with a message
    if (validSkills(a).length < MAX_MOVES){
      const s = $dataSkills[it.skillId]; if (!s) return;
      // bypass guard (see below)
      a._fonBypassLearn = true;
      _GA_learnSkill_orig.call(a, it.skillId);
      a._fonBypassLearn = false;
      sanitizeActorSkills(a);
      $gameMessage.add(MSG_LEARNED.replace("%1", a.name()).replace("%2", s.name));
      if (qHas() && !gameBusy()) presentNextQueued();
      return;
    }

    // Otherwise show replace UI (map only)
    if (window.Scene_FonaryLearnPrompt){
      if ($gameTemp) $gameTemp._fonLearnPromptOpen = true;
      SceneManager.push(Scene_FonaryLearnPrompt);
      if (Scene_FonaryLearnPrompt.prepare) Scene_FonaryLearnPrompt.prepare(a.actorId(), it.skillId);
      else { Scene_FonaryLearnPrompt._actorId = a.actorId(); Scene_FonaryLearnPrompt._skillId = it.skillId; }
    }
  }

  // ------------- map auto-scan: apply due learns (never in battle) -------------
  let _scanTick = 0;
  function applyLearnsOnMap(){
    if (inBattle()) return;
    for (const a of $gameParty.members()){
      if (!a || !isFonaryActor(a)) continue;
      const set = learnsetFor(a); if (!set.length) continue;
      sanitizeActorSkills(a);
      const lv = a.level|0;
      for (const {level,skillId} of set){
        if (level > lv) break;
        if (knows(a, skillId)) continue;
        if (isDeclined(a, skillId)) continue;

        if (validSkills(a).length < MAX_MOVES){
          const s = $dataSkills[skillId]; if (!s) continue;
          a._fonBypassLearn = true;
          _GA_learnSkill_orig.call(a, skillId);
          a._fonBypassLearn = false;
          sanitizeActorSkills(a);
          $gameMessage.add(MSG_LEARNED.replace("%1", a.name()).replace("%2", s.name));
        } else {
          qPushUnique(a.actorId(), skillId);
        }
      }
    }
    if (qHas() && !gameBusy()) presentNextQueued();
  }

  const _SM_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function(){
    _SM_update.call(this);
    if (inBattle()) return;
    _scanTick = (_scanTick + 1) % SCAN_INTERVAL;
    if (_scanTick === 0 && !gameBusy()) applyLearnsOnMap();
    if (!gameBusy() && qHas() && !($gameTemp && $gameTemp._fonLearnPromptOpen)) presentNextQueued();
  };

  // ------------- Replace/Skip prompt UI (MAP ONLY) -------------
  class Window_FonaryLearnList extends Window_Command {
    initialize(rect, actor, newSkillId){ this._actor=actor; this._newSkillId=newSkillId; super.initialize(rect); this.select(0); this.activate(); }
    makeCommandList(){
      const skills = validSkills(this._actor);
      for (const s of skills) this.addCommand(String(s.name), "forget", true, s.id);
      this.addCommand(TXT_SKIP, "skip", true, 0);
    }
    currentExt(){ const it=this._list[this.index()]; return it ? it.ext : 0; }
    drawItem(index){
      const it = this._list[index];
      this.resetTextColor();
      if (it && it.ext === 0) this.changeTextColor(ColorManager.textColor(8));
      super.drawItem(index);
    }
  }
  class Window_FonaryLearnHeader extends Window_Base {
    initialize(rect, actor, newSkillId){ this._actor=actor; this._newSkillId=newSkillId; super.initialize(rect); this.refresh(); }
    refresh(){
      this.createContents();
      const msg = MSG_REPLACE
        .replace("%1", this._actor.name())
        .replace("%2", ($dataSkills[this._newSkillId]?.name || ("Skill "+this._newSkillId)))
        .replace("%3", String(MAX_MOVES));
      this.drawTextEx(msg, 0, 0, this.contents.width);
    }
  }
  class Scene_FonaryLearnPrompt extends Scene_MenuBase {
    static prepare(actorId, skillId){ this._actorId=actorId; this._skillId=skillId; }
    create(){
      super.create();
      this._actor = $gameActors.actor(Scene_FonaryLearnPrompt._actorId);
      this._newSkillId = Scene_FonaryLearnPrompt._skillId;
      sanitizeActorSkills(this._actor);

      const ww = Graphics.boxWidth;
      const headH = this.calcWindowHeight(3, true);
      const listH = this.calcWindowHeight(Math.max(3, MAX_MOVES+1), true);

      this._header = new Window_FonaryLearnHeader(new Rectangle(0, 0, ww, headH), this._actor, this._newSkillId);
      this._list   = new Window_FonaryLearnList(new Rectangle(0, headH, ww, listH), this._actor, this._newSkillId);

      this._list.setHandler("forget", this.onForget.bind(this));
      this._list.setHandler("skip",   this.onSkip.bind(this));
      this._list.setHandler("cancel", this.onSkip.bind(this));

      this.addWindow(this._header);
      this.addWindow(this._list);
    }
    finishAndChain(){
      if ($gameTemp) $gameTemp._fonLearnPromptOpen = false;
      this.popScene();
      if (!gameBusy()) presentNextQueued();
    }
    onForget(){
      const oldId = this._list.currentExt(); if (!oldId) return this.onSkip();
      const sNew = $dataSkills[this._newSkillId];
      if ($dataSkills[oldId]) this._actor.forgetSkill(oldId);
      if (sNew){
        // bypass guard for the *replacement* learn
        this._actor._fonBypassLearn = true;
        _GA_learnSkill_orig.call(this._actor, this._newSkillId);
        this._actor._fonBypassLearn = false;
      }
      sanitizeActorSkills(this._actor);
      $gameMessage.add(MSG_LEARNED.replace("%1", this._actor.name()).replace("%2", (sNew?sNew.name:("Skill "+this._newSkillId))));
      SoundManager.playOk();
      this.finishAndChain();
    }
    onSkip(){
      markDeclined(this._actor, this._newSkillId);
      SoundManager.playCancel();
      this.finishAndChain();
    }
  }
  window.Scene_FonaryLearnPrompt = Scene_FonaryLearnPrompt;

  // ------------- CENTRAL GUARD: wrap learnSkill for Fonaries -------------
  const _GA_learnSkill_orig = Game_Actor.prototype.learnSkill;
  Game_Actor.prototype.learnSkill = function(skillId){
    // If not a Fonary actor, or we explicitly bypass, let it through unchanged.
    if (!isFonaryActor(this) || this._fonBypassLearn){
      return _GA_learnSkill_orig.call(this, skillId);
    }

    // Already knows? sanitize & return original to keep compatibility
    if (knows(this, skillId)){
      const r = _GA_learnSkill_orig.call(this, skillId);
      sanitizeActorSkills(this);
      return r;
    }

    // Fonary guard:
    if (inBattle()){
      // Never learn in battle: queue for after battle
      qPushUnique(this.actorId(), skillId);
      return; // no learning now
    }

    // On the map:
    if (validSkills(this).length >= MAX_MOVES){
      // Full → queue prompt, do not auto-replace
      qPushUnique(this.actorId(), skillId);
      return;
    }

    // Room available → allow learning now (with bypass)
    this._fonBypassLearn = true;
    const r = _GA_learnSkill_orig.call(this, skillId);
    this._fonBypassLearn = false;
    sanitizeActorSkills(this);
    return r;
  };

  // Keep lists clean if other plugins add/remove
  const _GA_forgetSkill = Game_Actor.prototype.forgetSkill;
  Game_Actor.prototype.forgetSkill = function(skillId){
    const r = _GA_forgetSkill.call(this, skillId);
    sanitizeActorSkills(this);
    return r;
  };

  // ------------- HARD GUARD: block learn scene pushes during battle -------------
  const _SM_push = SceneManager.push;
  SceneManager.push = function(sceneClass){
    try{
      if (inBattle()){
        const name = sceneClass && sceneClass.name ? String(sceneClass.name) : "";
        if (name === "Scene_FonaryLearnPrompt" || /LearnPrompt/i.test(name)){
          // Swallow and queue whatever was about to be prompted (if prepare statics exist)
          let aid = 0, sid = 0;
          if (window.Scene_FonaryLearnPrompt){
            aid = Number(Scene_FonaryLearnPrompt._actorId||0);
            sid = Number(Scene_FonaryLearnPrompt._skillId||0);
          }
          if (aid>0 && sid>0) qPushUnique(aid, sid);
          if ($gameTemp) $gameTemp._fonLearnPromptOpen = false;
          return;
        }
      }
    }catch(e){ console.error(e); }
    _SM_push.call(this, sceneClass);
  };

  // ------------- Optional: quiet vanilla level-up banner in battle for Fonaries -------------
  const _GA_displayLevelUp = Game_Actor.prototype.displayLevelUp;
  Game_Actor.prototype.displayLevelUp = function(newSkills){
    if (inBattle() && isFonaryActor(this)) return;
    _GA_displayLevelUp.call(this, newSkills);
  };

})();
