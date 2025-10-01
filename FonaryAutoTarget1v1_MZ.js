/*:
 * @target MZ
 * @plugindesc Fonary Learnsets (Actor whitelist): species learn moves on level-up from Actor notes; 4-move cap with replace/skip. Optional type guard.
 * @author You + ChatGPT
 * @help
 * AUTHORING (DATABASE)
 * --------------------
 * Put these tags on the **Actor** that represents the species template:
 *
 *   <SpeciesId: AQUAPUP>          # optional; if omitted, the Actor's name is used as the key
 *   <Types: Water, Ice>           # OPTIONAL — only used if Type Guard is on
 *   <StartMoves: Tackle, Growl>   # optional starting moves on join/capture
 *   <Learnset>
 *     5: Bubble
 *     9: Water Gun
 *     16: Aqua Ring
 *     22: Aqua Tail
 *   </Learnset>
 *
 * - Skill names or numeric IDs are both accepted (e.g., "22: 137, 205").
 * - Dual type? Use: <Types: Fire, Flying>
 * - This plugin teaches **exactly** what you list. No need for off-type allow lists.
 * - If you enable the optional **Type Guard** (params), the skill's <Type: ...>
 *   (from the Skill note) must match a species type; otherwise it will be skipped
 *   or warned depending on the guard mode. (Default: OFF.)
 *
 * RUNTIME BEHAVIOR
 * ----------------
 * - On **level up** → teach any moves for that level.
 * - On **party join/capture** → sync teaches everything up to current level
 *   and applies <StartMoves>.
 * - **4-move cap**: if full, a small prompt lets the player replace a move or skip.
 *
 * SPECIES RESOLUTION
 * ------------------
 * - Captured shells: this plugin looks up the species key from
 *     actor._fonary.speciesId (set by your capture plugin),
 *   then finds an Actor template in the DB that has a matching <SpeciesId: ...>
 *   and uses *that* Actor's notes for the learnset. If none is found, it falls
 *   back to the captured actor's own notes, then to its name as key.
 *
 * COMPATIBILITY
 * -------------
 * - Uses standard Game_Actor learnSkill / forgetSkill; your move UI/PP plugin
 *   continues to work and show <Type: ...> and PP (from Skill notes).
 * - Works with your shell capture system and trainer-in-slot-0 battle rules.
 *
 * @param MaxMoves
 * @text Max Moves per Fonary
 * @type number
 * @min 1
 * @max 8
 * @default 4
 *
 * @param TypeGuard
 * @text Type Guard
 * @type select
 * @option Off
 * @value off
 * @option Warn (console)
 * @value warn
 * @option Block (skip learning)
 * @value block
 * @default off
 *
 * @param LearnMsg
 * @text Message: Learned
 * @type string
 * @default %1 learned %2!
 *
 * @param ReplacePrompt
 * @text Message: Replace Prompt
 * @type string
 * @default %1 wants to learn %2, but already knows %3 moves. Replace a move?
 *
 * @param DontLearnText
 * @text Menu: Don't learn
 * @type string
 * @default Do not learn
 *
 * @command SyncLearnset
 * @text Sync Learnset (teach backlog)
 * @desc Teaches all eligible moves up to the actor's current level (with replacement prompts as needed).
 * @arg actorId
 * @type actor
 * @default 0
 *
 * @command SyncAllParty
 * @text Sync All Party
 * @desc Teaches eligible moves up to current level for all party fonaries.
 */

(() => {
  const PN = "FonaryLearnsets_MZ";
  const P  = PluginManager.parameters(PN);
  const MAX_MOVES      = Math.max(1, Number(P.MaxMoves || 4));
  const GUARD_MODE     = String(P.TypeGuard || "off"); // off|warn|block
  const MSG_LEARNED    = String(P.LearnMsg || "%1 learned %2!");
  const MSG_REPLACE    = String(P.ReplacePrompt || "%1 wants to learn %2, but already knows %3 moves. Replace a move?");
  const TXT_DONTLEARN  = String(P.DontLearnText || "Do not learn");

  // -------------------------------------------------------------------------
  // Parse DB notes → Species data (from **Actor** notes)
  // -------------------------------------------------------------------------
  const SPECIES_DB = Object.create(null); // key → { actorId, key, types:string[], start:number[], learn:[{level, skillId}] }
  const SPECIES_BY_ACTOR = Object.create(null); // actorId → speciesKey

  function skillTypeOf(id){
    const s = $dataSkills[id];
    if (!s) return "";
    const m = /<Type:\s*([^>]+)>/i.exec(s.note || "");
    return m ? m[1].trim() : "";
  }

  function parseListOfNamesOrIds(str){
    const out = [];
    (str || "").split(",").forEach(tok => {
      const t = String(tok).trim();
      if (!t) return;
      const n = Number(t);
      if (!Number.isNaN(n) && $dataSkills[n]) out.push(n);
      else {
        const id = findSkillIdByName(t);
        if (id) out.push(id);
      }
    });
    return out;
  }

  function findSkillIdByName(name){
    const target = String(name).trim().toLowerCase();
    for (let i = 1; i < $dataSkills.length; i++){
      const s = $dataSkills[i];
      if (s && String(s.name).trim().toLowerCase() === target) return i;
    }
    return 0;
  }

  function parseLearnsetBlock(note){
    const block = /<Learnset>([\s\S]*?)<\/Learnset>/i.exec(note || "");
    if (!block) return [];
    const lines = block[1].split(/\r?\n/);
    const result = [];
    for (const raw of lines){
      const line = String(raw).trim();
      if (!line) continue;
      const m = /^(\d+)\s*:\s*(.+)$/.exec(line);
      if (!m) continue;
      const lv = Number(m[1])|0;
      const list = parseListOfNamesOrIds(m[2]);
      for (const sid of list){ result.push({ level: lv, skillId: sid }); }
    }
    // sort by level asc (stable-ish)
    result.sort((a,b)=> a.level - b.level || a.skillId - b.skillId);
    return result;
  }

  function keyForActorData(dataActor){
    if (!dataActor) return "";
    const meta = dataActor.meta || {};
    const tag = meta.SpeciesId || meta.speciesId || "";
    return String(tag || dataActor.name || "").trim();
  }

  function parseActorsIntoSpeciesDb(){
    SPECIES_DB._keys = [];
    for (let aid = 1; aid < $dataActors.length; aid++){
      const A = $dataActors[aid];
      if (!A) continue;
      const key = keyForActorData(A);
      if (!key) continue; // ignore non-species actors if you prefer
      const typesTag = /<Types:\s*([^>]+)>/i.exec(A.note || "");
      const startTag = /<StartMoves:\s*([^>]+)>/i.exec(A.note || "");
      const types = typesTag ? typesTag[1].split(",").map(s=>s.trim()).filter(Boolean) : [];
      const start = startTag ? parseListOfNamesOrIds(startTag[1]) : [];
      const learn = parseLearnsetBlock(A.note || "");
      SPECIES_DB[key] = { actorId: aid, key, types, start, learn };
      SPECIES_BY_ACTOR[aid] = key;
      SPECIES_DB._keys.push(key);
    }
  }

  // Build when DB loads skills + actors
  const _DM_onLoad = DataManager.onLoad;
  DataManager.onLoad = function(object){
    _DM_onLoad.call(this, object);
    if (object === $dataActors || object === $dataSkills){
      // Only parse once both are available (skills may be needed for name→id)
      if ($dataActors && $dataSkills) parseActorsIntoSpeciesDb();
    }
  };

  // -------------------------------------------------------------------------
  // Species resolution for a live actor instance
  // -------------------------------------------------------------------------
  function speciesKeyOfActor(actor){
    if (!actor) return "";
    // Prefer the stamped capture species key
    const k = actor._fonary && actor._fonary.speciesId ? String(actor._fonary.speciesId).trim() : "";
    if (k) return k;
    // Else derive from its database actor
    const data = $dataActors[actor.actorId()];
    return keyForActorData(data);
  }

  function speciesDataForActor(actor){
    const key = speciesKeyOfActor(actor);
    if (!key) return null;
    // Direct key lookup
    if (SPECIES_DB[key]) return SPECIES_DB[key];
    // Fallback: if the actor's own DB entry had the data, it was stored under its key
    const aId = actor.actorId();
    const fallbackKey = SPECIES_BY_ACTOR[aId];
    if (fallbackKey && SPECIES_DB[fallbackKey]) return SPECIES_DB[fallbackKey];
    return null;
  }

  // -------------------------------------------------------------------------
  // Teaching logic
  // -------------------------------------------------------------------------
  function currentMoves(actor){ return actor ? actor.skills().slice() : []; }
  function knowsSkill(actor, skillId){ return !!currentMoves(actor).find(s => s && s.id === skillId); }

  function typeGuardAllows(actor, skillId){
    if (GUARD_MODE === "off") return true;
    const spec = speciesDataForActor(actor);
    const ty = skillTypeOf(skillId);
    if (!spec) return true; // nothing to check against
    if (!ty) return true;   // untyped skills are allowed
    const ok = spec.types.some(t => t.toLowerCase() === ty.toLowerCase());
    if (ok) return true;
    if (GUARD_MODE === "warn") console.warn(`[FonaryLearnsets] Blocked by type guard? %o trying to learn %o (type %o) not in %o`, actor.name(), $dataSkills[skillId]?.name, ty, spec.types);
    return false; // for warn + block we skip learning; warn just logs
  }

  function teachOrPrompt(actor, skillId){
    if (!actor || !skillId) return;
    if (knowsSkill(actor, skillId)) return;
    if (!typeGuardAllows(actor, skillId)) return;

    const moves = currentMoves(actor);
    if (moves.length < MAX_MOVES){
      actor.learnSkill(skillId);
      const msg = MSG_LEARNED.replace("%1", actor.name()).replace("%2", $dataSkills[skillId]?.name || `Skill ${skillId}`);
      $gameMessage.add(msg);
      return;
    }
    // Need replacement
    Scene_FonaryLearnPrompt.prepare(actor.actorId(), skillId);
    SceneManager.push(Scene_FonaryLearnPrompt);
  }

  function syncStartMoves(actor){
    const spec = speciesDataForActor(actor);
    if (!spec) return;
    for (const sid of spec.start){ if (!knowsSkill(actor, sid)) actor.learnSkill(sid); }
  }

  function syncBacklogUpToLevel(actor){
    const spec = speciesDataForActor(actor);
    if (!spec) return;
    const lv = actor.level;
    for (const entry of spec.learn){ if (entry.level <= lv) teachOrPrompt(actor, entry.skillId); }
  }

  // -------------------------------------------------------------------------
  // Hooks: level up + party join
  // -------------------------------------------------------------------------
  const _GA_levelUp = Game_Actor.prototype.levelUp;
  Game_Actor.prototype.levelUp = function(){
    _GA_levelUp.call(this);
    const spec = speciesDataForActor(this);
    if (!spec) return;
    const lv = this.level;
    for (const entry of spec.learn){ if (entry.level === lv) teachOrPrompt(this, entry.skillId); }
  };

  const _GP_addActor = Game_Party.prototype.addActor;
  Game_Party.prototype.addActor = function(actorId){
    const wasIn = this._actors.includes(actorId);
    _GP_addActor.call(this, actorId);
    if (!wasIn){
      const a = $gameActors.actor(actorId);
      if (a){ syncStartMoves(a); syncBacklogUpToLevel(a); }
    }
  };

  // -------------------------------------------------------------------------
  // Replace/Skip prompt scene
  // -------------------------------------------------------------------------
  class Window_FonaryLearnList extends Window_Command {
    initialize(rect, actor, newSkillId){ this._actor=actor; this._newSkillId=newSkillId; super.initialize(rect); this.select(0); this.activate(); }
    makeCommandList(){
      const skills = currentMoves(this._actor);
      for (const s of skills) this.addCommand(s.name, "forget", true, s.id);
      this.addCommand(TXT_DONTLEARN, "skip", true, 0);
    }
    currentExt(){ return this._list[this.index()] ? this._list[this.index()].ext : 0; }
    drawItem(index){
      const rect = this.itemRectWithPadding(index);
      const ext  = this._list[index].ext;
      this.resetTextColor();
      if (ext===0) this.changeTextColor(ColorManager.textColor(8));
      Window_Command.prototype.drawItem.call(this, index);
    }
  }

  class Window_FonaryLearnHeader extends Window_Base {
    initialize(rect, actor, newSkillId){ this._actor=actor; this._newSkillId=newSkillId; super.initialize(rect); this.refresh(); }
    refresh(){
      this.createContents(); this.contents.clear();
      const name = this._actor.name();
      const s = $dataSkills[this._newSkillId];
      const sname = s ? s.name : `Skill ${this._newSkillId}`;
      const msg = MSG_REPLACE.replace("%1", name).replace("%2", sname).replace("%3", String(MAX_MOVES));
      this.drawTextEx(msg, 0, 0, this.contents.width);
    }
  }

  class Scene_FonaryLearnPrompt extends Scene_MenuBase {
    static prepare(actorId, skillId){ this._actorId=actorId; this._skillId=skillId; }
    create(){
      super.create();
      const a = $gameActors.actor(Scene_FonaryLearnPrompt._actorId);
      this._actor = a; this._newSkillId = Scene_FonaryLearnPrompt._skillId;
      const ww = Graphics.boxWidth, wh = Graphics.boxHeight;
      const headH = this.calcWindowHeight(3, true);
      const listH = this.calcWindowHeight(Math.max(3, MAX_MOVES+1), true);
      const headRect = new Rectangle(0, 0, ww, headH);
      const listRect = new Rectangle(0, headH, ww, listH);
      this._header = new Window_FonaryLearnHeader(headRect, a, this._newSkillId);
      this._list   = new Window_FonaryLearnList(listRect, a, this._newSkillId);
      this._list.setHandler("forget", this.onForget.bind(this));
      this._list.setHandler("skip",   this.onSkip.bind(this));
      this._list.setHandler("cancel", this.onSkip.bind(this));
      this.addWindow(this._header);
      this.addWindow(this._list);
    }
    onForget(){
      const forgetId = this._list.currentExt();
      if (!forgetId) return this.onSkip();
      const sNew = $dataSkills[this._newSkillId];
      const sOld = $dataSkills[forgetId];
      if (sOld) this._actor.forgetSkill(forgetId);
      if (sNew) this._actor.learnSkill(this._newSkillId);
      const name = this._actor.name();
      const sname = sNew ? sNew.name : `Skill ${this._newSkillId}`;
      $gameMessage.add(MSG_LEARNED.replace("%1", name).replace("%2", sname));
      SoundManager.playOk();
      this.popScene();
    }
    onSkip(){ SoundManager.playCancel(); this.popScene(); }
  }
  window.Scene_FonaryLearnPrompt = Scene_FonaryLearnPrompt;

  // -------------------------------------------------------------------------
  // Plugin commands
  // -------------------------------------------------------------------------
  PluginManager.registerCommand(PN, "SyncLearnset", args => {
    const id = Number(args.actorId||0);
    const a = id ? $gameActors.actor(id) : null;
    if (a){ syncStartMoves(a); syncBacklogUpToLevel(a); }
  });
  PluginManager.registerCommand(PN, "SyncAllParty", args => {
    $gameParty.members().forEach(a => { if (a) { syncStartMoves(a); syncBacklogUpToLevel(a); } });
  });
})();
