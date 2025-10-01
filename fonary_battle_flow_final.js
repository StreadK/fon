/*:
 * @target MZ
 * @plugindesc Fonary Final Battle Flow: KO→(wait)→EXP→(gap)→Learn prompts; next foe held until prompts close. No double-KO, no early prompt, no blank entries; 4-move replace like Pokémon.
 * @author You
 *
 * @param MaxMoves
 * @type number
 * @min 1 @max 4
 * @default 4
 *
 * @param KoMinWait
 * @text Frames to wait after collapse before EXP
 * @type number @min 0 @max 240
 * @default 60
 *
 * @param ExpWait
 * @text Frames to wait after EXP before prompts
 * @type number @min 0 @max 240
 * @default 24
 *
 * @param PromptGap
 * @text Extra gap before first learn prompt
 * @type number @min 0 @max 240
 * @default 24
 *
 * @param AfterLearnWait
 * @text Frames to wait after finishing prompts
 * @type number @min 0 @max 240
 * @default 18
 *
 * @param LearnYes
 * @type string
 * @default Learn
 * @param LearnNo
 * @type string
 * @default Do not learn
 * @param WantToLearn
 * @type string
 * @default %1 wants to learn %2. Learn it?
 * @param ReplacePrompt
 * @type string
 * @default Choose a move to forget for %2:
 * @param LearnedMsg
 * @type string
 * @default %1 learned %2!
 */

(() => {
  'use strict';

  const PN = 'fonary_battle_flow_final';
  const P  = PluginManager.parameters(PN);

  const MAX_MOVES        = 4; // hard cap as requested
  const KO_MIN_WAIT      = Math.max(0, Number(P.KoMinWait || 60));
  const EXP_WAIT         = Math.max(0, Number(P.ExpWait || 24));
  const PROMPT_GAP       = Math.max(0, Number(P.PromptGap || 24));
  const AFTER_LEARN_WAIT = Math.max(0, Number(P.AfterLearnWait || 18));

  const TXT_YES  = String(P.LearnYes   || 'Learn');
  const TXT_NO   = String(P.LearnNo    || 'Do not learn');
  const MSG_WANT = String(P.WantToLearn|| '%1 wants to learn %2. Learn it?');
  const MSG_REPL = String(P.ReplacePrompt || 'Choose a move to forget for %2:');
  const MSG_DONE = String(P.LearnedMsg || '%1 learned %2!');

  // ---------------------------------------------------------------------------
  // Helpers (sanitizing avoids blank entries forever)
  // ---------------------------------------------------------------------------
  const inBattle = () => !!($gameParty?.inBattle?.());
  const gameBusy = () => !!($gameMessage?.isBusy?.());

  function sanitizeSkillsArray(arr){
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = Object.create(null);
    for (const id of arr){
      if (!id || id <= 0) continue;
      const sk = $dataSkills[id];
      if (!sk) continue;
      const nm = String(sk.name||'').trim();
      if (!nm) continue;            // block nameless skills
      if (seen[id]) continue;       // dedupe
      seen[id] = 1;
      out.push(id);
      if (out.length >= MAX_MOVES) break;
    }
    return out;
  }
  function validKnownSkills(actor){
    actor._skills = sanitizeSkillsArray(actor._skills||[]);
    return actor._skills.map(id => $dataSkills[id]).filter(s => s && (s.name||'').trim());
  }
  function addSkillDirect(actor, sid){
    const sk = $dataSkills[sid]; if (!sk || !(sk.name||'').trim()) return;
    actor._skills = sanitizeSkillsArray(actor._skills||[]);
    if (!actor._skills.includes(sid)) actor._skills.push(sid);
    actor._skills = sanitizeSkillsArray(actor._skills).slice(0, MAX_MOVES);
    actor.refresh?.();
  }
  function replaceSkillDirect(actor, oldSid, newSid){
    const sk = $dataSkills[newSid]; if (!sk || !(sk.name||'').trim()) return;
    actor._skills = sanitizeSkillsArray(actor._skills||[]);
    const i = actor._skills.indexOf(oldSid);
    if (i >= 0) actor._skills[i] = newSid;
    else if (actor._skills.length) actor._skills[actor._skills.length-1] = newSid;
    else actor._skills.push(newSid);
    actor._skills = sanitizeSkillsArray(actor._skills).slice(0, MAX_MOVES);
    actor.refresh?.();
  }
  function actorLevel(a){
    if (!a) return 1;
    if (typeof a.level === 'function') return a.level();
    if (typeof a.level === 'number')  return a.level;
    if (typeof a._level === 'number') return a._level;
    return 1;
  }
  function isFonaryActor(a){
    if (!a) return false;
    if (a._fonary?.speciesId) return true;
    const id = a._actorId || a.actorId?.() || 0;
    const db = $dataActors[id];
    return !!(db && /<SpeciesId:\s*[^>]+>/i.test(String(db?.note||'')));
  }
  // Use your existing learnset reader if present; else no auto learns.
  function skillsLearnedAtLevelSafe(a, lv){
    if (typeof window.skillsLearnedAtLevel === 'function') return window.skillsLearnedAtLevel(a, lv)||[];
    return [];
  }
  // Use your existing EXP award if present; else small fallback.
  function awardExpNowForSafe(enemy){
    if (typeof window.awardExpNowFor === 'function') { try { window.awardExpNowFor(enemy); return; } catch(_){} }
    const alive = $gameParty.aliveMembers().filter(Boolean);
    const s = Math.max(1, alive.length);
    for (const a of alive) a.gainExp?.(Math.floor(20/s));
  }

  // ---------------------------------------------------------------------------
  // Never allow nameless/invalid learns in battle (hard lock)
  // ---------------------------------------------------------------------------
  const _GA_learnSkill = Game_Actor.prototype.learnSkill;
  Game_Actor.prototype.learnSkill = function(skillId){
    const sk = $dataSkills[skillId];
    if (!sk || !(sk.name||'').trim()) return; // ignore junk forever
    const r = _GA_learnSkill.call(this, skillId);
    this._skills = sanitizeSkillsArray(this._skills||[]);
    return r;
  };

  // ---------------------------------------------------------------------------
  // Robust KO → EXP → Learn sequencer
  //   - Marks enemy as perma-removed
  //   - Holds next appear while prompts open
  //   - Prompts only after collapse + cooldown
  // ---------------------------------------------------------------------------
  function spritesBusy(scene){
    const ss = scene?._spriteset;
    if (!ss) return false;
    const busyE = ss._enemySprites?.some(s => s && s.isEffecting && s.isEffecting());
    const busyA = ss._actorSprites?.some(s  => s && s.isEffecting && s.isEffecting());
    return !!(busyE || busyA);
  }
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

  // Hold appears while busy
  const _GE_appear = Game_Enemy.prototype.appear;
  Game_Enemy.prototype.appear = function(){
    if ($gameTroop && $gameTroop._fonLockAppear) {
      if (!this._fonDeferredMarked){
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
      if (!e || e._fonPermaDead) continue;
      if (e.isHidden?.() || !e.isAppeared?.()) _GE_appear.call(e);
      e._fonDeferredMarked = false;
    }
    if ($gameTroop) $gameTroop._fonDeferredEnemies = [];
  }

  const _GE_die = Game_Enemy.prototype.die;
  Game_Enemy.prototype.die = function(){
    _GE_die.call(this);
    if (!inBattle()) return;

    // Permanently remove this battler so it can't come back
    this._fonPermaDead = true;
    this._hidden = true;
    this._appeared = false;
    this.clearActions();

    const enemy = this;
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Battle)) return;

    // Start a local state machine; no global overrides
    let phase = 0;  // 0 wait collapse, 1 cooldown, 2 exp, 3 build prompts, 4 show prompts, 5 release
    let wait  = 0;

    $gameTroop._fonLockAppear = true;      // block next appear until we finish
    const _updateOrig = scene.update;

    scene.update = function(){
      _updateOrig.call(this);
      if (gameBusy()) return;

      switch (phase){
        case 0: // ensure collapse finished & sprites idle
          if (!collapseFinished(this, enemy)) return;
          if (spritesBusy(this)) return;
          wait = KO_MIN_WAIT; phase = 1; return;

        case 1: // cooldown
          if (wait-- > 0) return;
          phase = 2; return;

        case 2: // EXP + wait
          awardExpNowForSafe(enemy);
          wait = EXP_WAIT; phase = 21; return;

        case 21:
          if (wait-- > 0) return;
          phase = 3; return;

        case 3: // build learn queue
          this._fonLearnQueue = [];
          try {
            const party = ($gameParty.members()||[]).filter(Boolean);
            for (const a of party){
              if (!isFonaryActor(a)) continue;
              const L = actorLevel(a);
              const sids = skillsLearnedAtLevelSafe(a, L);
              a._skills = sanitizeSkillsArray(a._skills||[]);
              for (const sid of sids){
                const sk = $dataSkills[sid];
                if (!sk || !(sk.name||'').trim()) continue;
                if (a._skills.includes(sid)) continue;
                this._fonLearnQueue.push({ actor:a, sid });
              }
            }
          } catch(_) {}
          wait = PROMPT_GAP; phase = 31; return;

        case 31:
          if (wait-- > 0) return;
          phase = 4; return;

        case 4: // one prompt at a time
          if (this._fonLearnQueue.length === 0){
            phase = 5; return;
          }
          if (this._fonLearnActive) return; // wait for current prompt
          const it = this._fonLearnQueue.shift();
          if (!it || !it.actor || !it.sid) return;
          const sk = $dataSkills[it.sid];
          if (!sk || !(sk.name||'').trim()) return;
          this.fonPromptLearn(it.actor, it.sid, () => { /* tiny pause */ });
          return;

        case 5: // done; release and flush
          $gameTroop._fonLockAppear = false;
          flushDeferredAppears();
          wait = AFTER_LEARN_WAIT; phase = 51; return;

        case 51:
          if (wait-- > 0) return;
          this.update = _updateOrig;
          return;
      }
    };
  };

  // ---------------------------------------------------------------------------
  // Learn UI (ALWAYS confirm; with 4 moves, FORCE choose one to replace)
  // ---------------------------------------------------------------------------
  class Window_FonYN extends Window_Command{
    initialize(rect, yesText, noText){ this._yes=yesText; this._no=noText; super.initialize(rect); this.select(0); this.activate(); }
    makeCommandList(){ this.addCommand(this._yes,'yes'); this.addCommand(this._no,'no'); }
  }
  class Window_FonHeader extends Window_Base{
    initialize(rect, text){ this._text=text; super.initialize(rect); this.refresh(); }
    refresh(){ this.createContents(); this.drawTextEx(this._text, 0, 0, this.contents.width); }
  }
  class Window_FonReplace extends Window_Command{
    initialize(rect, actor){ this._actor=actor; super.initialize(rect); this.select(0); this.activate(); }
    makeCommandList(){
      const skills = validKnownSkills(this._actor); // sanitized → no blanks
      for (const s of skills) this.addCommand(String(s.name), 'forget', true, s.id);
      this.addCommand(TXT_NO, 'skip', true, 0);
    }
    currentExt(){ const it=this._list[this.index()]; return it ? it.ext : 0; }
    drawItem(index){
      const it=this._list[index]; this.resetTextColor();
      if (it && it.symbol==='skip') this.changeTextColor(ColorManager.textColor(8));
      super.drawItem(index);
    }
  }

  Scene_Battle.prototype.fonPromptLearn = function(actor, sid, onDone){
    const sk = $dataSkills[sid]; if (!sk || !(sk.name||'').trim()) return onDone&&onDone();

    const ww = Graphics.boxWidth;
    const headH = this.calcWindowHeight(3,true);
    const ynH   = this.calcWindowHeight(2,true);
    const y     = Math.floor(Graphics.boxHeight*0.15);

    this._fonLearnActive = true;

    const want = MSG_WANT.replace('%1', actor.name()).replace('%2', sk.name);
    this._fonLearnHeader = new Window_FonHeader(new Rectangle(0, y, ww, headH), want);
    this.addWindow(this._fonLearnHeader);

    this._fonYesNo = new Window_FonYN(new Rectangle(Math.floor(ww*0.25), y+headH, Math.floor(ww*0.5), ynH), TXT_YES, TXT_NO);
    this._fonYesNo.setHandler('yes', () => this.fonLearnYes(actor, sid, onDone));
    this._fonYesNo.setHandler('no',  () => this.fonFinishPrompt(onDone));
    this._fonYesNo.setHandler('cancel', () => this.fonFinishPrompt(onDone));
    this.addWindow(this._fonYesNo);
  };

  Scene_Battle.prototype.fonLearnYes = function(actor, sid, onDone){
    const sk = $dataSkills[sid]; if (!sk || !(sk.name||'').trim()) return this.fonFinishPrompt(onDone);

    const have = validKnownSkills(actor).length;
    if (have < MAX_MOVES){
      addSkillDirect(actor, sid);
      $gameMessage.add(MSG_DONE.replace('%1', actor.name()).replace('%2', sk.name));
      return this.fonFinishPrompt(onDone);
    }

    // Force choose one to forget
    const ww = Graphics.boxWidth;
    const y  = Math.floor(Graphics.boxHeight*0.15);
    const txt= MSG_REPL.replace('%1', actor.name()).replace('%2', sk.name);

    this.removeChild(this._fonLearnHeader); this._fonLearnHeader=null;
    this._fonLearnHeader = new Window_FonHeader(new Rectangle(0, y, ww, this.calcWindowHeight(3,true)), txt);
    this.addWindow(this._fonLearnHeader);

    this.removeChild(this._fonYesNo); this._fonYesNo=null;

    const listH = this.calcWindowHeight(MAX_MOVES+1,true);
    this._fonReplaceList = new Window_FonReplace(new Rectangle(0, y+this._fonLearnHeader.height, ww, listH), actor);
    this._fonReplaceList.setHandler('forget', () => {
      const forgetId = this._fonReplaceList.currentExt();
      if (!forgetId) return this.fonFinishPrompt(onDone);
      replaceSkillDirect(actor, forgetId, sid);
      $gameMessage.add(MSG_DONE.replace('%1', actor.name()).replace('%2', sk.name));
      this.fonFinishPrompt(onDone);
    });
    this._fonReplaceList.setHandler('skip',   () => this.fonFinishPrompt(onDone));
    this._fonReplaceList.setHandler('cancel', () => this.fonFinishPrompt(onDone));
    this.addWindow(this._fonReplaceList);
  };

  Scene_Battle.prototype.fonFinishPrompt = function(onDone){
    const kill = w => { if (w){ w.close(); this.removeChild(w); } };
    kill(this._fonLearnHeader);
    kill(this._fonYesNo);
    kill(this._fonReplaceList);
    this._fonLearnHeader = this._fonYesNo = this._fonReplaceList = null;
    this._fonLearnActive = false;

    try { BattleManager.refreshStatus?.(); this._statusWindow?.refresh?.(); } catch(_){}
    if (onDone) onDone();
  };

})();
