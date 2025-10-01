/*:
 * @target MZ
 * @plugindesc Fonary KO→EXP→(delayed) Learn prompt. No blanks, no auto-overwrite. If 4 moves, ALWAYS ask which to replace. Safe send-out; no double-KO comeback.
 * @author You
 *
 * @param MaxMoves
 * @type number
 * @min 1
 * @max 8
 * @default 4
 *
 * @param KoMinWait
 * @text Frames to wait after collapse before EXP
 * @type number
 * @min 0
 * @max 240
 * @default 60
 *
 * @param ExpWait
 * @text Frames to wait after EXP before prompts
 * @type number
 * @min 0
 * @max 240
 * @default 24
 *
 * @param PromptGap
 * @text Extra gap before first prompt
 * @type number
 * @min 0
 * @max 240
 * @default 24
 *
 * @param AfterLearnWait
 * @text Frames to wait after closing prompts
 * @type number
 * @min 0
 * @max 240
 * @default 18
 *
 * @param LearnYes
 * @type string
 * @default Learn
 *
 * @param LearnNo
 * @type string
 * @default Do not learn
 *
 * @param WantToLearn
 * @type string
 * @default %1 wants to learn %2. Learn it?
 *
 * @param ReplacePrompt
 * @type string
 * @default Choose a move to forget for %2:
 *
 * @param LearnedMsg
 * @type string
 * @default %1 learned %2!
 */

(() => {
  'use strict';
  const PN = 'Fonary_KO_Exp_Learn_Flow';
  const P  = PluginManager.parameters(PN);

  const MAX_MOVES       = Math.max(1, Number(P.MaxMoves || 4));
  const KO_MIN_WAIT     = Math.max(0, Number(P.KoMinWait || 60));
  const EXP_WAIT        = Math.max(0, Number(P.ExpWait || 24));
  const PROMPT_GAP      = Math.max(0, Number(P.PromptGap || 24));
  const AFTER_LEARN_WAIT= Math.max(0, Number(P.AfterLearnWait || 18));

  const TXT_YES   = String(P.LearnYes || 'Learn');
  const TXT_NO    = String(P.LearnNo  || 'Do not learn');
  const MSG_WANT  = String(P.WantToLearn || '%1 wants to learn %2. Learn it?');
  const MSG_REPL  = String(P.ReplacePrompt || 'Choose a move to forget for %2:');
  const MSG_DONE  = String(P.LearnedMsg || '%1 learned %2!');

  const inBattle = () => !!($gameParty?.inBattle?.());
  const gameBusy = () => !!($gameMessage?.isBusy?.());

  // --- Helpers: sanitize skills to prevent blanks --------------------------------
  function sanitizeSkillsArray(arr){
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = Object.create(null);
    for (const id of arr){
      if (!id || id <= 0) continue;
      const sk = $dataSkills[id];
      if (!sk) continue;
      const nm = (sk.name || '').trim();
      if (!nm) continue;
      if (seen[id]) continue;
      seen[id] = 1;
      out.push(id);
      if (out.length >= 8) break; // hard safety
    }
    return out;
  }
  function validKnownSkills(actor){
    actor._skills = sanitizeSkillsArray(actor._skills || []);
    return actor._skills.map(id => $dataSkills[id]).filter(s => s && (s.name||'').trim());
  }
  function addSkillDirect(actor, sid){
    if (!sid || !$dataSkills[sid]) return;
    const nm = ($dataSkills[sid].name||'').trim(); if (!nm) return;
    actor._skills = sanitizeSkillsArray(actor._skills || []);
    if (!actor._skills.includes(sid)){
      actor._skills.push(sid);
      actor._skills = sanitizeSkillsArray(actor._skills).slice(0, MAX_MOVES);
      actor.refresh?.();
    }
  }
  function replaceSkillDirect(actor, oldSid, newSid){
    if (!newSid || !$dataSkills[newSid]) return;
    const nm = ($dataSkills[newSid].name||'').trim(); if (!nm) return;
    actor._skills = sanitizeSkillsArray(actor._skills || []);
    const i = actor._skills.indexOf(oldSid);
    if (i >= 0) actor._skills[i] = newSid;
    else if (actor._skills.length) actor._skills[actor._skills.length-1] = newSid;
    else actor._skills.push(newSid);
    actor._skills = sanitizeSkillsArray(actor._skills).slice(0, MAX_MOVES);
    actor.refresh?.();
  }

  // --- Learnset access (uses your existing helpers if present) --------------------
  function actorLevel(a){
    if (!a) return 1;
    if (typeof a.level === 'function') return a.level();
    if (typeof a.level === 'number') return a.level;
    if (typeof a._level === 'number') return a._level;
    return 1;
  }
  function isFonaryActor(a){
    if (!a) return false;
    if (a._fonary?.speciesId) return true;
    const id = a._actorId || a.actorId?.() || 0;
    const db = $dataActors[id];
    return !!(db && /<SpeciesId:\s*[^>]+>/i.test(String(db?.note || '')));
  }
  function skillsLearnedAtLevelSafe(a, lv){
    // Prefer existing function from your setup
    if (typeof window.skillsLearnedAtLevel === 'function') return window.skillsLearnedAtLevel(a, lv) || [];
    // Fallback: no learnset provided → learn nothing
    return [];
  }

  // --- EXP award hook (call your existing function if present) --------------------
  function awardExpNowForSafe(enemy){
    if (typeof window.awardExpNowFor === 'function') {
      try { window.awardExpNowFor(enemy); return; } catch(_) {}
    }
    // Minimal fallback: 20 EXP split equally among alive actors
    const recipients = $gameParty.aliveMembers().filter(Boolean);
    const s = Math.max(1, recipients.length);
    for (const a of recipients) a.gainExp?.(Math.floor(20 / s));
  }

  // --- KO → EXP → prompt timing (keeps next send-out on hold) --------------------
  function collapseFinished(scene, enemy){
    const ss = scene?._spriteset;
    if (!ss || !ss._enemySprites) return true;
    const sp = ss._enemySprites.find(s => s && s._battler === enemy);
    if (!sp) return true;
    if (sp.isEffecting?.() && sp.isEffecting()) return false;
    if (sp._appeared) return false;
    if (sp.opacity > 0) return false;
    return true;
  }

  // Defer enemy appear while we handle prompts
  const _GE_appear = Game_Enemy.prototype.appear;
  Game_Enemy.prototype.appear = function(){
    if ($gameTroop && $gameTroop._fonLockAppear) {
      if (!this._fonDeferredMarked) {
        this._fonDeferredMarked = true;
        ($gameTroop._fonDeferredEnemies ||= []).push(this);
      }
      return;
    }
    _GE_appear.call(this);
  };
  function flushDeferredAppears(){
    const list = $gameTroop?._fonDeferredEnemies || [];
    while (list.length){
      const e = list.shift();
      if (!e) continue;
      if (e.isHidden?.() || !e.isAppeared?.()) _GE_appear.call(e);
      e._fonDeferredMarked = false;
    }
    if ($gameTroop) $gameTroop._fonDeferredEnemies = [];
  }

  // Tight, local sequencer on KO; no global update overrides
  const _GE_die = Game_Enemy.prototype.die;
  Game_Enemy.prototype.die = function(){
    _GE_die.call(this);
    if (!inBattle()) return;
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Battle)) return;

    const enemy = this;
    const startFrame = Graphics.frameCount;
    let phase = 0;            // 0: wait collapse, 1: KO_MIN_WAIT, 2: EXP, 3: prompts, 4: release
    let wait = 0;

    $gameTroop._fonLockAppear = true; // hold next foe until we finish

    const _updateOrig = scene.update;
    scene.update = function(){
      _updateOrig.call(this);
      if (gameBusy()) return;

      switch(phase){
        case 0: // wait until collapse fully finished
          if (!collapseFinished(this, enemy)) return;
          phase = 1; wait = KO_MIN_WAIT; return;

        case 1: // KO cooldown
          if (wait-- > 0) return;
          phase = 2; return;

        case 2: // EXP then small gap
          awardExpNowForSafe(enemy);
          wait = EXP_WAIT;
          phase = 21; return;
        case 21:
          if (wait-- > 0) return;
          phase = 3;
          // Build learn queue (valid only; no blanks)
          this._fonLearnQueue = [];
          const party = ($gameParty.members() || []).filter(Boolean);
          for (const a of party){
            if (!isFonaryActor(a)) continue;
            const lv = actorLevel(a);
            const toLearn = skillsLearnedAtLevelSafe(a, lv) || [];
            for (const sid of toLearn){
              if (!sid || sid<=0) continue;
              const sk = $dataSkills[sid];
              if (!sk) continue;
              const nm = (sk.name||'').trim(); if (!nm) continue;
              // Skip if already knows
              a._skills = sanitizeSkillsArray(a._skills || []);
              if (a._skills.includes(sid)) continue;
              this._fonLearnQueue.push({ actor:a, sid });
            }
          }
          wait = PROMPT_GAP;
          phase = 31; return;

        case 31: // gap before first prompt
          if (wait-- > 0) return;
          // Fallthrough to prompt loop
          phase = 32; return;

        case 32: // show prompts one by one
          if (!this._fonLearnQueue || this._fonLearnQueue.length === 0){
            phase = 4; return;
          }
          if (this._fonLearnActive) return; // wait until current prompt closes
          const it = this._fonLearnQueue.shift();
          if (!it || !it.actor || !it.sid) return;
          const s = $dataSkills[it.sid]; if (!s || !(s.name||'').trim()) return; // guard
          // show prompt
          this.fonShowLearnPrompt_Fix(it.actor, it.sid, () => {
            // tiny pause after closing one prompt
            wait = 12; phase = 33;
          });
          return;

        case 33: // tiny wait after closing a prompt
          if (wait-- > 0) return;
          phase = 32; return;

        case 4: // release appear lock and clean up
          $gameTroop._fonLockAppear = false;
          flushDeferredAppears();
          wait = AFTER_LEARN_WAIT;
          phase = 41; return;

        case 41:
          if (wait-- > 0) return;
          // restore
          this.update = _updateOrig;
          return;
      }
    };
  };

  // --- Learn UI (NEVER blanks; if 4 moves, ALWAYS choose one to forget) ----------
  class Window_FonYN extends Window_Command{
    initialize(rect, yesText, noText){ this._yes=yesText; this._no=noText; super.initialize(rect); this.select(0); this.activate(); }
    makeCommandList(){ this.addCommand(this._yes, 'yes'); this.addCommand(this._no, 'no'); }
  }
  class Window_FonHeader extends Window_Base{
    initialize(rect, text){ this._text = text; super.initialize(rect); this.refresh(); }
    refresh(){ this.createContents(); this.drawTextEx(this._text, 0, 0, this.contents.width); }
  }
  class Window_FonReplace extends Window_Command{
    initialize(rect, actor){ this._actor=actor; super.initialize(rect); this.select(0); this.activate(); }
    makeCommandList(){
      const skills = validKnownSkills(this._actor); // already filtered → no blanks
      for (const s of skills) this.addCommand(String(s.name), 'forget', true, s.id);
      this.addCommand(TXT_NO, 'skip', true, 0);
    }
    currentExt(){ const it=this._list[this.index()]; return it ? it.ext : 0; }
    drawItem(index){
      const it=this._list[index]; this.resetTextColor();
      if (it && it.symbol === 'skip') this.changeTextColor(ColorManager.textColor(8));
      super.drawItem(index);
    }
  }

  // Single entry point used by the sequencer above
  Scene_Battle.prototype.fonShowLearnPrompt_Fix = function(actor, newSkillId, onFinish){
    const s = $dataSkills[newSkillId];
    if (!s || !(s.name||'').trim()) return onFinish && onFinish();

    const ww = Graphics.boxWidth;
    const headH = this.calcWindowHeight(3,true);
    const ynH   = this.calcWindowHeight(2,true);
    const y     = Math.floor(Graphics.boxHeight*0.15);

    const want = MSG_WANT.replace('%1', actor.name()).replace('%2', s.name);

    this._fonLearnActive = true;

    // Header
    this._fonLearnHeader = new Window_FonHeader(new Rectangle(0, y, ww, headH), want);
    this.addWindow(this._fonLearnHeader);

    // Yes/No
    this._fonYesNo = new Window_FonYN(new Rectangle(Math.floor(ww*0.25), y+headH, Math.floor(ww*0.5), ynH), TXT_YES, TXT_NO);
    this._fonYesNo.setHandler('yes', () => this._fonOnChooseLearnYes_Fix(actor, newSkillId, onFinish));
    this._fonYesNo.setHandler('no',  () => this._fonFinishLearn_Fix(onFinish));
    this._fonYesNo.setHandler('cancel', () => this._fonFinishLearn_Fix(onFinish));
    this.addWindow(this._fonYesNo);
  };

  Scene_Battle.prototype._fonOnChooseLearnYes_Fix = function(actor, sid, onFinish){
    const s = $dataSkills[sid]; if (!s || !(s.name||'').trim()) return this._fonFinishLearn_Fix(onFinish);

    const have = validKnownSkills(actor).length;

    if (have < MAX_MOVES){
      // Add directly (no overwrite), still sanitized
      addSkillDirect(actor, sid);
      $gameMessage.add(MSG_DONE.replace('%1', actor.name()).replace('%2', s.name));
      return this._fonFinishLearn_Fix(onFinish);
    }

    // Exactly 4: show replace list (no blanks)
    const ww = Graphics.boxWidth;
    const y  = Math.floor(Graphics.boxHeight*0.15);
    const txt= MSG_REPL.replace('%1', actor.name()).replace('%2', s.name);

    this.removeChild(this._fonLearnHeader); this._fonLearnHeader=null;
    this._fonLearnHeader = new Window_FonHeader(new Rectangle(0, y, ww, this.calcWindowHeight(3,true)), txt);
    this.addWindow(this._fonLearnHeader);

    this.removeChild(this._fonYesNo); this._fonYesNo=null;

    const listH = this.calcWindowHeight(MAX_MOVES + 1, true);
    this._fonReplaceList = new Window_FonReplace(new Rectangle(0, y+this._fonLearnHeader.height, ww, listH), actor);
    this._fonReplaceList.setHandler('forget', () => {
      const forgetId = this._fonReplaceList.currentExt();
      if (!forgetId) return this._fonFinishLearn_Fix(onFinish);
      replaceSkillDirect(actor, forgetId, sid);
      $gameMessage.add(MSG_DONE.replace('%1', actor.name()).replace('%2', s.name));
      this._fonFinishLearn_Fix(onFinish);
    });
    this._fonReplaceList.setHandler('skip',   () => this._fonFinishLearn_Fix(onFinish));
    this._fonReplaceList.setHandler('cancel', () => this._fonFinishLearn_Fix(onFinish));
    this.addWindow(this._fonReplaceList);
  };

  Scene_Battle.prototype._fonFinishLearn_Fix = function(onFinish){
    const kill = w => { if (w){ w.close(); this.removeChild(w); } };
    kill(this._fonLearnHeader);
    kill(this._fonYesNo);
    kill(this._fonReplaceList);
    this._fonLearnHeader = this._fonYesNo = this._fonReplaceList = null;
    this._fonLearnActive = false;

    try { BattleManager.refreshStatus?.(); this._statusWindow?.refresh?.(); } catch(_){}

    if (onFinish) onFinish();
  };

})();
/* === Fonary: No-Blank Replace List (append at end of plugin) === */
(() => {
  "use strict";

  const MAX_MOVES = 4; // hard cap

  // Fully sanitize an actor's move array: valid IDs only, non-empty names, dedupe, cap
  function fonarySanitizeSkills(actor) {
    if (!actor) return [];
    const out = [];
    const seen = Object.create(null);
    const arr = Array.isArray(actor._skills) ? actor._skills.slice() : [];

    for (const id of arr) {
      if (!id || id <= 0) continue;
      const sk = $dataSkills[id];
      if (!sk) continue;
      const nm = String(sk.name || "").trim();
      if (!nm) continue;             // no nameless skills
      if (seen[id]) continue;        // dedupe
      seen[id] = 1;
      out.push(id);
      if (out.length >= MAX_MOVES) break;
    }
    actor._skills = out;
    return out;
  }

  // Guard: never learn an invalid/nameless skill
  const _GA_learnSkill = Game_Actor.prototype.learnSkill;
  Game_Actor.prototype.learnSkill = function(skillId) {
    const sk = $dataSkills[skillId];
    if (!sk || !String(sk.name || "").trim()) return; // block invalid/blank
    _GA_learnSkill.call(this, skillId);
    fonarySanitizeSkills(this); // keep clean after any learn
  };

  // Helper to rebuild any replace list window from sanitized skills
  function rebuildReplaceList(windowCmd, actor, skipText) {
    const txtSkip = (skipText && String(skipText).trim()) || "Do not learn";
    windowCmd.clearCommandList?.();

    const ids = fonarySanitizeSkills(actor);
    for (const id of ids) {
      const name = $dataSkills[id].name;
      windowCmd.addCommand(name, "forget", true, id);
    }
    windowCmd.addCommand(txtSkip, "skip", true, 0); // always visible & labeled
    windowCmd.refresh?.();
    windowCmd.activate?.();
    windowCmd.select?.(0);
  }

  // If your plugin defines a specific replace list class, patch its builder.
  if (window.Window_FonaryLearnList) {
    const _mk = Window_FonaryLearnList.prototype.makeCommandList;
    Window_FonaryLearnList.prototype.makeCommandList = function() {
      if (this._actor) {
        rebuildReplaceList(this, this._actor, this._skipText);
      } else {
        _mk?.call(this);
      }
    };
  }
  if (window.Window_FonReplace) {
    const _mk2 = Window_FonReplace.prototype.makeCommandList;
    Window_FonReplace.prototype.makeCommandList = function() {
      if (this._actor) {
        rebuildReplaceList(this, this._actor, this._skipText);
      } else {
        _mk2?.call(this);
      }
    };
  }

  // If your Scene_Battle has a “Yes” handler, ensure a full list rebuild when full.
  function forceStrictReplaceHook(handlerName) {
    const orig = Scene_Battle.prototype[handlerName];
    if (!orig) return;
    Scene_Battle.prototype[handlerName] = function() {
      const a = this._fonLearnActor, sid = this._fonLearnSkill;
      if (a && sid) {
        const have = fonarySanitizeSkills(a).length;
        if (have >= MAX_MOVES) {
          // If a replace window already exists, rebuild it cleanly (removes blanks)
          if (this._fonReplaceList?.makeCommandList) {
            this._fonReplaceList.makeCommandList();
            return;
          }
        }
      }
      return orig.apply(this, arguments);
    };
  }
  forceStrictReplaceHook("fonOnChooseLearnYes");     // our earlier name
  forceStrictReplaceHook("_fonOnChooseLearnYes_Fix"); // alternate name used in fixes
})();
