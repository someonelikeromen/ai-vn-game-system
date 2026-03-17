# [v0.15] 鈥?Phase 4 鎴柇淇 + 缁啓閲嶈瘯锛?026-03-16锛?
### 淇敼鏂囦欢
- src/core/llmClient.js
- src/engine/gameLoop.js

### 淇敼鍐呭
- llmClient.js锛歮axTokens 涓?null/0/undefined 鏃朵笉鍚?API 鍙戦€?max_tokens 瀛楁锛堜笉闄愬埗杈撳嚭闀垮害锛夛紱鏂板 opts.onFinishReason 鍥炶皟锛屽彲鎹曡幏娴佸紡鍝嶅簲鐨?finish_reason
- gameLoop.js Phase 4锛氬幓鎺夌‖缂栫爜鐨?maxTokens: 2048 涓婇檺锛屾敼涓?null锛涙坊鍔犳渶澶?娆＄画鍐欓噸璇曗€斺€旇嫢 UpdateVariable 鏍囩鏈棴鍚堬紝灏嗛儴鍒嗗搷搴斾綔涓?assistant prefill锛岃拷鍔犺缁х画娑堟伅閲嶈皟 LLM

### 淇敼鍘熷洜
- 鏃ュ織涓?Phase 4锛圲pdateVariable锛変粎杈撳嚭 313 瀛楃渚挎埅鏂紝UpdateVariable 鍧楁湭闂悎
- 鍘熸湁 maxTokens: 2048 杩囧皬锛屼笖鏃犲畬鏁存€ф鏌?
### 淇敼缁撴灉
- Phase 4 涓嶅啀鍙?token 涓婇檺绾︽潫
- 鑻ヨ緭鍑轰笉瀹屾暣锛岃嚜鍔ㄧ画鍐欐渶澶?娆★紝纭繚鏍囩瀹屾暣鍖归厤

---

﻿# 鏃犻檺姝﹀簱 娓告垙绯荤粺 鈥?鐗堟湰鍙樻洿鏃ュ織

> 鏍煎紡锛氭瘡鏉¤褰曞寘鍚?**淇敼鏂囦欢**銆?*淇敼鍐呭**銆?*淇敼鍘熷洜**銆?*淇敼缁撴灉**

---

## [v0.1] 鈥?鍒濆鏋勫缓锛堢害 2026-02-22 鍓嶏級

### 鍒濆鍔熻兘鍩虹嚎
- Express 鏈嶅姟鍣?+ 瀛樻。绠＄悊锛坄session.js`锛?- 浜虹墿鍗?棰勮瑙ｆ瀽锛坄configLoader.js`锛?- 鎻愮ず璇嶇粍瑁咃紙`promptBuilder.js`锛?- LLM 娴佸紡璋冪敤锛坄llmClient.js`锛?- 姝ｅ垯澶勭悊绠￠亾锛坄regexPipeline.js`锛?- 鍙橀噺寮曟搸锛坄varEngine.js`锛?- 鍩虹鏃ュ織锛坄logger.js`锛?- 鍟嗗煄鐢熸垚/鍏戞崲锛坄shopEngine.js`, `shopPrompt.js`, `shopStore.js`锛?- 涓栫晫妗ｆ绠＄悊锛坄worldAnchorPrompt.js`, `worldArchiveStore.js`锛?- 涓绘父鎴忕晫闈€佸晢鍩庣晫闈€佽鑹茬敓鎴愮晫闈?
---

## [v0.2] 鈥?鎻愮ず璇嶆敞鍏ヤ綅缃慨澶嶏紙2026-02-23锛?
### 淇敼鏂囦欢
- `src/promptBuilder.js`
- `src/varEngine.js`

### 淇敼鍐呭
- 淇浜嗕笘鐣屼功鏉＄洰鐨勬敞鍏ヤ綅缃€昏緫锛歚extPosition === 0` 鐨勫父椹绘潯鐩敞鍏ョ郴缁熸秷鎭紝`extPosition === 4 + depth === 0` 鐨勬潯鐩敞鍏ユ渶鍚庝竴鏉＄敤鎴锋秷鎭紙UpdateVariable 鍧楋級
- 淇浜?`CharacterSheet` 绛夌姸鎬佹暟鎹簲鍦ㄥ彉閲忔洿鏂拌鍒欙紙UpdateVariable锛夐儴鍒嗗睍绀虹殑闂锛屼箣鍓嶆敞鍏ヤ綅缃敊璇鑷?AI 鏃犳硶姝ｇ‘鐪嬪埌鐘舵€佸揩鐓?
### 淇敼鍘熷洜
- 鐢ㄦ埛鍙嶆槧鎬濈淮閾俱€侀€夐」绛夊唴瀹规棤娉曟甯告覆鏌擄紱鍙橀噺鏇存柊浣嶇疆涓嶅锛屽唴瀹逛笉瀹屾暣

### 淇敼缁撴灉
- UpdateVariable 蹇収姝ｇ‘鍑虹幇鍦ㄦ渶鍚庝竴鏉＄敤鎴锋秷鎭腑
- AI 鑳芥纭鍙栧拰鏇存柊 statData

---

## [v0.3] 鈥?鎬濈淮閾炬覆鏌撲慨澶?+ 閫夐」闈㈡澘浼樺寲锛?026-02-23锛?
### 淇敼鏂囦欢
- `src/regexPipeline.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`

### 淇敼鍐呭
- 淇鎬濈淮閾炬湭瀹屽叏鎶樺彔鐨勯棶棰橈細鍦?`fullDisplayPipeline` 涓鍔?`<think>` 鍓嶇紑鍓ョ锛岄槻姝㈤璁?Rule 0 灏嗗叾杞负瀛楅潰 "think" 鏂囨湰
- 寮曞叆 `renderMixed()` 鍑芥暟锛氫唬鐮佸洿鏍忥紙``` ` `` `锛夊唴鍐呭鐩存帴娉ㄥ叆涓哄師濮?HTML锛屽叾浣欒蛋 `renderPlainText`
- 鍓嶇閫夐」闈㈡澘鏀逛负鍦ㄨ緭鍏ユ爮涓婃柟鏄剧ず鍥涗釜妯帓鎸夐挳锛岀偣鍑诲悗濉厖鍒拌緭鍏ユ锛堢敤鎴峰彲鍦ㄩ€夐」鍩虹涓婁慨鏀癸級
- 淇浜嗛儴鍒嗕腑鏂囧瓧绗﹀湪 Node.js 缁堢涓嬬殑涔辩爜闂锛圔uffer.concat 瑙ｇ爜锛?
### 淇敼鍘熷洜
- 鎬濈淮閾句粛鏈夐儴鍒嗘湭琚姌鍙犲鐞嗭紱閫夐」鏈互浜や簰鎸夐挳褰㈠紡鍛堢幇

### 淇敼缁撴灉
- 鎬濈淮閾惧畬鏁存姌鍙犱负鍙睍寮€鐨?details 缁勪欢
- 閫夐」鏄剧ず涓烘í鎺掓寜閽紝鏀寔鐢ㄦ埛淇敼鍚庡彂閫?
---

## [v0.4] 鈥?鐘舵€佸揩鐓т笌閲嶅鐞嗗姛鑳斤紙2026-02-23锛?
### 淇敼鏂囦欢
- `server.js`
- `src/session.js`
- `public/app.js`

### 淇敼鍐呭
- 姣忔潯 AI 鍥炲娑堟伅鐜板湪闄勫甫 `statSnapshotBefore`锛氳褰曡娑堟伅鐢熸垚鍓嶇殑 statData 蹇収
- 鏂板 `POST /api/sessions/:id/messages/:idx/reprocess-vars`锛氫粠鎸囧畾娑堟伅鐨?`statSnapshotBefore` 閲嶆柊瑙ｆ瀽 UpdateVariable锛屽疄鐜板彉閲忛噸鏂板鐞?- 鏂板 `POST /api/sessions/:id/messages/:idx/reprocess-display`锛氶噸鏂拌窇鏄剧ず姝ｅ垯锛屽埛鏂?HTML
- 鍓嶇娣诲姞"閲嶆柊澶勭悊鍙橀噺"鍜?閲嶆柊澶勭悊姝ｅ垯"鎸夐挳

### 淇敼鍘熷洜
- 鐢ㄦ埛闇€瑕佸湪閲嶆柊鍙戦€佹秷鎭悗锛岃兘浠庝笂涓€娆＄殑鐘舵€侀噸鏂板鐞嗗彉閲忥紝鑰屼笉蹇呮墜鍔ㄤ慨姝?
### 淇敼缁撴灉
- 鍙€変腑浠绘剰鍘嗗彶 AI 娑堟伅閲嶆柊澶勭悊鍙橀噺锛岀姸鎬佹爲鍑嗙‘鍥炴粴骞舵洿鏂?
---

## [v0.5] 鈥?鍏」鏂扮壒鎬э紙2026-02-26锛屽ぇ鐗堟湰锛?
### 5.1 鏃ュ織瀹屾暣鎬т慨澶?
**淇敼鏂囦欢**锛歚src/logger.js`

**淇敼鍐呭**锛?- `chatReq()` 鍜?`chatResp()` 浠?`writeAsync`锛堝紓姝ワ紝鍙兘涓㈠け锛夋敼涓?`write`锛堝悓姝ワ紝淇濊瘉鍐欏叆锛?- `log.tail()` 鏂板 `Infinity` 鍙傛暟鏀寔锛屽彲鑾峰彇鍏ㄩ儴鏃ュ織琛岋紙鑰岄潪浠呮渶鍚?N 琛岋級

**淇敼鍘熷洜**锛歀LM 璇锋眰/鍝嶅簲鏃ュ織鏄帓鏌ラ棶棰樻渶閲嶈鐨勮褰曪紝鏈嶅姟宕╂簝鏃跺紓姝ュ啓鍏ュ彲鑳藉鑷翠涪澶?
**淇敼缁撴灉**锛欳HAT 绾у埆鏃ュ織纭繚鍦ㄤ换浣曟儏鍐典笅閮藉畬鏁磋惤鐩橈紱"鍏ㄩ儴鏃ュ織"鎸夐挳鍙煡鐪嬪叏閲忚褰?
---

### 5.2 鏂版父鎴忛鏉¤緭鍏?
**淇敼鏂囦欢**锛歚public/index.html`銆乣public/app.js`

**淇敼鍐呭**锛?- 鏂板缓娓告垙鍚戝绗笁姝ワ紙瀛樻。璁剧疆锛夋坊鍔?`<textarea id="ng-first-input">` 杈撳叆妗?- `confirmNewGame()` 璇诲彇璇ヨ緭鍏ユ鍐呭锛岀敤浣滅涓€鏉?`<input>` 娑堟伅锛堢暀绌哄垯浣跨敤 `[娓告垙寮€濮媇`锛?
**淇敼鍘熷洜**锛氱敤鎴峰笇鏈涘湪寤烘。鏃跺氨棰勮寮€鍦烘儏澧冿紝鑰岄潪鍙兘浣跨敤榛樿寮€鍦虹櫧

**淇敼缁撴灉**锛氬彲鍦ㄥ缓妗ｆ椂鑷畾涔夌涓€鏉＄帺瀹惰緭鍏ュ唴瀹?
---

### 5.3 澶氫笘鐣屼功鍔犺浇

**淇敼鏂囦欢**锛歚public/index.html`銆乣public/app.js`銆乣server.js`

**淇敼鍐呭**锛?- 鏂板缓娓告垙鍚戝绗簩姝ョ殑涓栫晫鍒楄〃鏀逛负澶氶€夛紙澶嶉€夋锛?- `ngState.selectedWorlds` 鏀逛负鏁扮粍 `[{id, name}]`
- `POST /api/sessions` 鎺ユ敹 `worldAnchorIds`锛堟暟缁勶紝鏇夸唬鏃х殑鍗曞€?`worldAnchorId`锛?- 鏈嶅姟绔亶鍘嗘暟缁勶紝瀵规瘡涓?ID 璋冪敤 `applyWorldArchiveToSession()`
- `session.statData.Multiverse.CurrentWorldName` 鏀逛负鏁扮粍鏍煎紡锛歚[[world1, world2], 'ActiveWorlds']`

**淇敼鍘熷洜**锛氭敮鎸佸悓鏃舵縺娲诲涓笘鐣岃儗鏅紙濡?鐏奖+鍜掓湳浜ゅ弶"绫诲満鏅級

**淇敼缁撴灉**锛氬缓妗ｆ椂鍙嬀閫夊涓笘鐣屾。妗堬紝鍧囪娉ㄥ叆 statData 鍜?CurrentWorldName

---

### 5.4 鐘舵€侀潰鏉跨編鍖?
**淇敼鏂囦欢**锛歚public/style.css`銆乣public/app.js`

**淇敼鍐呭**锛?- `.stat-float` 閲嶆柊璁捐鏍峰紡锛堟洿澶у搴︺€佹瘺鐜荤拑鏁堟灉銆佹笎鍙樿儗鏅級
- 鏂板 `.stat-hero-card`锛氶《閮ㄨ鑹蹭俊鎭崱鐗囷紙鍚嶇О/绉板彿/韬唤/鏍囩锛?- 鏂板 `.stat-world-banner`锛氬綋鍓嶄笘鐣屾í骞咃紙涓栫晫鍚?浣嶇疆/鏃堕棿锛?- `STAT_SECTIONS` 鏁扮粍澧炲姞 `cls` 灞炴€х敤浜庤壊褰╁尯鍒?- `renderStatFloat()` 閲嶆瀯锛氬厛娓叉煋 Hero 鍗＄墖鍜屼笘鐣屾í骞咃紝鍐嶆覆鏌撳悇鐘舵€佸尯鍧?
**淇敼鍘熷洜**锛氶粯璁ょ姸鎬侀潰鏉跨己涔忓眰娆℃劅鍜屽彲璇绘€?
**淇敼缁撴灉**锛氱姸鎬侀潰鏉挎湁鏄庢樉鐨勮瑙夊眰娆★紱Hero 鍗＄墖绐佸嚭瑙掕壊鏍稿績淇℃伅锛涗繚鎸佸彲鎵╁睍鎬?
---

### 5.5 鍟嗗煄璐墿杞?
**淇敼鏂囦欢**锛歚public/shop.html`銆乣public/shop.css`銆乣public/shop.js`

**淇敼鍐呭**锛?- `shop.html` 娣诲姞璐墿杞︽寜閽紙鍚暟閲忚鏍?`#cartBadge`锛夊拰璐墿杞﹂潰鏉?`#cartPanel`
- `state.cart = []`锛宍state.cartOpen` 绠＄悊璐墿杞︾姸鎬?- 闈炲凡鍏戞崲鐗╁搧鍗＄墖娣诲姞"馃洅"鍔犺喘鎸夐挳
- 鏂板鍑芥暟锛?  - `toggleCart(itemId)` 鈥?鍔犲叆/绉婚櫎璐墿杞︼紝鏇存柊瑙掓爣
  - `updateCartBadge()` 鈥?鍒锋柊瑙掓爣鏁伴噺
  - `renderCartPanel()` 鈥?娓叉煋璐墿杞︾墿鍝佸垪琛?+ 鎬讳环 + 浼氳瘽閫夋嫨
  - `checkoutCart()` 鈥?鎵归噺鍏戞崲鍏ㄩ儴璐墿杞︾墿鍝侊紝鍚堝苟 prefillText

**淇敼鍘熷洜**锛氱敤鎴峰笇鏈涗竴娆℃€ч€夊畾澶氫欢鐗╁搧缁熶竴鍏戞崲

**淇敼缁撴灉**锛氬晢鍩庢敮鎸佽喘鐗╄溅鎵归噺鍏戞崲锛屽厬鎹㈠悗鑷姩棰勫～鍏呮父鎴忚緭鍏ユ

---

### 5.6 涓栫晫閿氱偣浣滀负鐗╁搧鍏ュ簱

**淇敼鏂囦欢**锛歚server.js`銆乣src/shopEngine.js`

**淇敼鍐呭**锛?- `POST /api/worldanchor/pull`锛氫笘鐣岄敋鐐硅 pull 鍚庯紝涓嶅啀鐩存帴婵€娲伙紝鑰屾槸浣滀负鐗╁搧璁板綍鍒?`session.statData.CharacterSheet.ShopInventory`
- `shopEngine.executeRedemption()`锛氬厬鎹㈠畬鎴愬悗灏嗚褰曟帹鍏?`CharacterSheet.ShopInventory`
- 鏂板 `buildPrefillText(item)` 鍑芥暟锛氭牴鎹墿鍝佺被鍨嬬敓鎴愯嚜鐒惰瑷€棰勫～鍏呮枃鏈紙濡?銆愮郴缁熴€戣鍔ㄨ兘鍔涖€怷XX銆戯紙Y鏄燂級宸插厬鎹㈠苟瀹屾垚鍐呭寲"锛?- 杩斿洖鍊间腑鍖呭惈 `prefillText`

**淇敼鍘熷洜**锛氫笘鐣岄敋鐐瑰拰鑳藉姏鐗╁搧搴斿厛浣滀负"宸叉寔鏈夌墿鍝?瀛樺湪锛岃€岄潪绔嬪嵆鏇存敼娓告垙鐘舵€侊紱闇€瑕侀濉厖寮曞鐜╁鑷劧鍙欒堪鑾峰緱杩囩▼

**淇敼缁撴灉**锛氬厬鎹㈠悗鐗╁搧杩涘叆搴撳瓨锛涢濉厖鏂囨湰鑷姩鍑虹幇鍦ㄦ父鎴忚緭鍏ユ

---

### 5.7 杈撳叆妗嗛濉厖锛圠ocalStorage 妗ユ帴锛?
**淇敼鏂囦欢**锛歚public/shop.js`銆乣public/app.js`

**淇敼鍐呭**锛?- `doRedeem()`銆乣doPull()`銆乣checkoutCart()` 鎴愬姛鍚庡啓鍏?`localStorage.pendingShopPrefill`锛堝惈 sessionId銆乼ext銆乼imestamp锛?- `app.js` 鏂板 `applyPendingShopPrefill(sessionId)`锛氬姞杞藉瓨妗ｆ椂妫€鏌?localStorage锛岃嫢鏈?10 鍒嗛挓鍐呫€佸尮閰嶅綋鍓?session 鐨勯濉厖鍒欒嚜鍔ㄥ～鍏ヨ緭鍏ユ

**淇敼鍘熷洜**锛氬晢鍩庨〉鍜屾父鎴忎富椤垫槸涓嶅悓椤甸潰锛岄渶瑕佽法椤甸潰浼犻€掗濉厖淇℃伅

**淇敼缁撴灉**锛氫粠鍟嗗煄杩斿洖娓告垙椤甸潰鏃讹紝杈撳叆妗嗚嚜鍔ㄥ嚭鐜拌喘涔板唴瀹圭殑鑷劧璇█鎻忚堪

---

### 5.8 涓栫晫涔﹁鍒欒ˉ鍏咃紙鏃犻檺姝﹀簱demov1.3 (5).json锛?
**淇敼鏂囦欢**锛歚D:\test2\鏃犻檺姝﹀簱demov1.3 (5).json`锛堜笘鐣屼功 Meta-Rule 鏉＄洰锛?
**淇敼鍐呭**锛堥€氳繃 Node.js 鑴氭湰绋嬪簭鍖栦慨鏀癸級锛?- **瑙勫垯 5 鈥?鍏戞崲鐨勬棤鐥涘唴鍖栧師鍒?*锛氬厬鎹笉閫犳垚鐥涜嫤锛屾弿杩颁负鑷劧鍏峰鎴栬嚜琛屼慨鐐煎埌姝ゆ按骞?- **瑙勫垯 6 鈥?琚姩鎶€鑳界殑闈欓粯杩愯浆鍘熷垯**锛氳鍔ㄦ妧鑳戒竴鐩寸敓鏁堬紝绂佹鍑虹幇"姝ゅ埢鎮勭劧杩愯浆"绛変富鍔ㄦ縺娲绘弿鍐?- **瑙勫垯 7 鈥?鍏戞崲浜嬩欢鐨勫彊浜嬪鐞嗗師鍒?*锛氱敤鎴峰厬鎹㈣緭鍏ユ椂涓嶇敓鎴?UpdateVariable 鍧楋紝涓撴敞鍙欎簨

**淇敼鍘熷洜**锛氱敤鎴峰弽鏄?AI 瀵硅鍔ㄦ妧鑳界殑鎻忓啓鏂瑰紡涓嶆纭紝浼氬嚭鐜?绯荤粺婵€娲昏鍔?绫诲彊浜嬶紱鍏戞崲鏃朵笉搴旂敓鎴愬彉閲忔洿鏂拌鍙?
**淇敼缁撴灉**锛欰I 瀵硅鍔ㄦ妧鑳界殑鎻忓啓鏇磋嚜鐒讹紱鍏戞崲浜嬩欢涓嶄骇鐢熺郴缁熸劅鐨勫彉閲忓潡

---

## [v0.6] 鈥?鑳藉姏鍐呭寲 + 绌胯秺鏂瑰紡 + 瑙掕壊绫诲瀷宸紓鍖栵紙2026-02-26锛?
### 6.1 涓栫晫涔︼細鑳藉姏鍐呭寲鍘熷垯鍔犲己

**淇敼鏂囦欢**锛歚D:\test2\鏃犻檺姝﹀簱demov1.3 (5).json`锛堜笘鐣屼功 Meta-Rule 鏉＄洰 + 鏇存柊瑙勫垯鏉＄洰锛?
**淇敼鍐呭**锛?- **瑙勫垯 3锛堣兘鍔涘唴鍖栧師鍒欙級** 鎺緸寮哄寲锛氫粠"鍏呭垎铻嶅叆"鏀逛负"绯荤粺鍙槸鍙鍖栨帴鍙ｏ紝瑙掕壊鑳藉姏鑴辩绯荤粺渚濈劧瀛樺湪锛涚郴缁熶笉璧嬩簣鑳藉姏锛屽彧鏄収浜畠浠?
- **鏇存柊瑙勫垯鏉＄洰** 鏂板瑙勫垯 8锛?  - 鑳藉姏鐨勬湰璐細PassiveAbilities 姘歌繙鐢熸晥鏃犲紑鍏筹紝PowerSources/Techniques 鏄?鑷繁鐨勬妧鑹?鑰岄潪澶栨寕
  - 寰界珷瀹屾暣鎬э細StarMedals 鍙兘浠ユ暣鏋氭暣鏁板舰寮忓瓨鍦紝绂佹纰庣墖/鍗婃灇褰㈡€?- **瑙勫垯 8 鈥?寰界珷瀹屾暣鎬у師鍒?*锛圡eta-Rule锛夛細鏄庣‘绂佹鐢熸垚寰界珷纰庣墖/娈嬬己褰㈡€?- **瑙勫垯 9 鈥?鏈湡涓庣┛瓒婅€呭彊浜嬪尯鍒?*锛氭湰鍦熻鑹叉湁鑷劧鐩磋锛涚┛瓒婅€呮湁淇℃伅宸拰鏂囧寲閿欎綅鎰燂紝浣嗕笉鍙ｅご瀹ｆ壃

**淇敼鍘熷洜**锛氱敤鎴疯姹傚己璋冩妧鑳?鐭ヨ瘑/閬撳叿绛夐兘鏄鑹茶嚜韬浐鏈夌殑锛岀郴缁熷彧鏄樉绀哄伐鍏凤紱寰界珷涓嶅簲鍑虹幇纰庣墖

**淇敼缁撴灉**锛欰I 鎻忓啓鎶€鑳戒娇鐢ㄦ洿鑷劧锛屼笉渚濊禆"绯荤粺"鍙欒堪锛涘窘绔犺瘎浼颁笉鍐嶅嚭鐜扮鐗囧舰寮?
---

### 6.2 鎬濈淮閾撅紙CoT锛夛細澧炲姞鐘舵€佹劅鐭ユ楠?
**淇敼鏂囦欢**锛歚D:\test2\Izumi Reload 0211.json`锛坄鍙洖鎬濈淮閾綻 prompt锛宨d: `ffa1f75e-9cfd-4c99-892a-ffe0b27f5945`锛?
**淇敼鍐呭**锛?- 鍦ㄧ幇鏈夋€濈淮閾炬湯灏炬敞鍏?**"鏃犻檺姝﹀簱涓撻」妫€鏌?** 姝ラ锛?  - 鏌ラ槄 `CharacterSheet.UserPanel.Personality`锛岀‘璁ゆ湰杞涓烘槸鍚︾鍚堣鑹叉€ф牸
  - 妫€鏌?`PassiveAbilities`锛堜竴鐩寸敓鏁堬紝鏃犻渶婵€娲绘弿鍐欙級
  - 纭 `PowerSources/ApplicationTechniques` 浣跨敤鎰熻鍍?鑷繁鐨勬妧鑹?
  - 鑻ヨ緭鍏ュ惈"璐拱浜?鍏戞崲浜?锛岃烦杩?UpdateVariable锛屼笓娉ㄥ彊浜?  - 鏌ラ槄 `Origin.Type`锛屽尯鍒嗘湰鍦?绌胯秺鑰呭彊浜嬫柟寮?
**淇敼鍘熷洜**锛氭€濈淮閾鹃渶瑕佸鎺ョ姸鎬?JSON 鐨勬€ф牸绛夐┍鍔紝浣?AI 琛屼负鏇磋创鍚堣鑹茶瀹?
**淇敼缁撴灉**锛欰I 姣忔鐢熸垚鍓嶄細涓诲姩妫€鏌ヨ鑹茬姸鎬佹爲锛岃涓轰笌鎬ф牸/鎶€鑳?鏉ユ簮绫诲瀷鏇翠竴鑷?
---

### 6.3 瑙掕壊绫诲瀷宸紓鍖栨彁绀鸿瘝锛堟湰鍦?vs 绌胯秺鑰咃級

**淇敼鏂囦欢**锛歚src/characterPrompt.js`銆乣server.js`

**淇敼鍐呭**锛?- 鏂板 `TRAVERSAL_PRESETS` 甯搁噺锛氬畾涔?6 绉嶇┛瓒婃柟寮忥紙寮備笘鐣岃浆鐢?閲嶇敓/澶鸿垗/鍙敜/绯荤粺绌胯秺/鑷畾涔夛級鐨勮缁嗘弿杩?- 鏂板 `buildCharTypeBlock(charType, traversalMethod, traversalDesc)` 鍑芥暟锛?  - 鏈湡锛氱畝鐭鏄庯紙鍘熶綇姘戯紝鏃犺法涓栫晫瑙嗚锛?  - 绌胯秺鑰咃細鍖呭惈绌胯秺鏂瑰紡鎻忚堪 + 鐭ヨ瘑搴撹鍒?+ 蹇冪悊鐗瑰緛锛堟枃鍖栭敊浣嶆劅锛? 闈㈡澘瑙勫垯
- `buildQuestionMessages` 鏍规嵁绌胯秺鑰呯被鍨嬮澶栫敓鎴愯法鏂囧寲閫傚簲棰樼洰
- `buildFromAnswersMessages` / `buildFromBackgroundMessages` 鎺ユ敹 `{charType, traversalMethod, traversalDesc}` 骞堕檮鍔犲樊寮傚寲鍧?- `server.js`锛歚POST /api/character/questions` 鍜?`POST /api/character/generate` 浼犲叆 `charType/traversalMethod/traversalDesc`

**淇敼鍘熷洜**锛氭湰鍦熻鑹插拰绌胯秺鑰呰鑹茬殑鐢熸垚閫昏緫瀹屽叏涓嶅悓锛堢煡璇嗗簱銆佸績鐞嗗垱浼ゃ€佺郴缁熸劅鐭ユ潵婧愶級

**淇敼缁撴灉**锛氱┛瓒婅€呰鑹茶嚜鍔ㄦ嫢鏈?鐜颁唬鍦扮悆鐭ヨ瘑"鑺傜偣鍜屾枃鍖栭敊浣嶅績鐞嗘弿鍐欙紱鏈湡瑙掕壊涓嶅彈褰卞搷

---

### 6.4 瑙掕壊鍒涘缓椤甸潰锛氱┛瓒婃柟寮忛€夋嫨 UI

**淇敼鏂囦欢**锛歚public/character.html`銆乣public/character.js`銆乣public/character.css`

**淇敼鍐呭**锛?- `character.html`锛氶棶鍗?鑳屾櫙妯″紡鍚勫鍔?`#quizTraversalBlock / #bgTraversalBlock`锛屽惈 6 涓?`.traversal-btn` 鍜岃嚜瀹氫箟鏂囨湰妗?- 閫夋嫨"绌胯秺鑰?鏃舵墠鏄剧ず绌胯秺鏂瑰紡闈㈡澘锛坄display:none` 鈫?`display:flex`锛?- 閫夋嫨"鑷畾涔?绌胯秺鏂瑰紡鏃舵樉绀烘枃鏈
- `character.js`锛?  - `state` 鏂板 `traversalMethod: 'isekai'`銆乣traversalDesc: ''`
  - 鏂板 `setupTraversalButtons()` 缁戝畾鎸夐挳閫昏緫
  - `setupCharTypeButtons()` 鑱斿姩鏄剧ず/闅愯棌绌胯秺闈㈡澘
  - 鐢熸垚璇锋眰甯﹀叆 `traversalMethod/traversalDesc` 鍙傛暟
- `character.css`锛氭柊澧?`.traversal-block`銆乣.traversal-presets`銆乣.traversal-btn` 鏍峰紡

**淇敼鍘熷洜**锛氶渶瑕佸湪 UI 灞傛彁渚涚┛瓒婃柟寮忛€夋嫨鍏ュ彛锛屽苟灏嗛€夋嫨浼犻€掔粰 AI

**淇敼缁撴灉**锛氳鑹茬敓鎴愰〉鏀寔 5 绉嶉璁剧┛瓒婃柟寮?+ 1 绉嶈嚜瀹氫箟杈撳叆锛涢€夋嫨缁撴灉褰卞搷 AI 鐨勫垱浣滄柟鍚?
---

### 6.5 鏂板缓娓告垙鍚戝锛氱┛瓒婃柟寮忛€夋嫨 UI

**淇敼鏂囦欢**锛歚public/index.html`銆乣public/app.js`銆乣public/style.css`

**淇敼鍐呭**锛?- `index.html` Step 1 鍦?绌胯秺鑰?绫诲瀷鎸夐挳涓嬫柟娣诲姞绌胯秺鏂瑰紡閫夋嫨闈㈡澘锛坄#ng-traversal-block`锛?- `app.js`锛?  - `ngState` 鏂板 `traversalMethod: 'isekai'`銆乣traversalDesc: ''`
  - 鏂板 `NG_TRAVERSAL_HINTS` 瀵硅薄
  - `openNewGame()` 閲嶇疆绌胯秺鐩稿叧鐘舵€?  - 绫诲瀷鎸夐挳鐐瑰嚮浜嬩欢鑱斿姩鏄剧ず/闅愯棌绌胯秺闈㈡澘
  - 鏂板绌胯秺鏂瑰紡鎸夐挳缁勪簨浠剁粦瀹?  - `ngUpdateSummary()` 鍦ㄦ憳瑕佷腑鏄剧ず绌胯秺鏂瑰紡锛堝"绌胯秺鑰吢烽噸鐢?锛?  - `confirmNewGame()` 浼犲叆 `traversalMethod/traversalDesc`
- `server.js`锛歚POST /api/sessions` 鎺ユ敹骞跺瓨鍌?`traversalMethod/traversalDesc`
- `style.css` 鏂板 `.traversal-btn` 鏍峰紡

**淇敼鍘熷洜**锛氭柊寤烘父鎴忔椂閫夋嫨绌胯秺鏂瑰紡锛屼娇瀛樻。浠庝竴寮€濮嬪氨璁板綍瑙掕壊鐨勬潵婧愯儗鏅?
**淇敼缁撴灉**锛氬瓨妗ｇ殑 `session.traversalMethod` 鏈夋晥璁板綍锛涜鑹插崱 `UserPanel.Origin` 鍐欏叆绌胯秺绫诲瀷

---

### 6.6 session.statData 鍐欏叆 Origin 瀛楁

**淇敼鏂囦欢**锛歚server.js`锛坄applyCharacterToSession` 鍑芥暟锛?
**淇敼鍐呭**锛?- 鍦?`applyCharacterToSession()` 涓紝鏍规嵁 `session.characterType` 鍐欏叆 `CharacterSheet.UserPanel.Origin`锛?  ```js
  up.Origin.Type = ['鏈湡'|'绌胯秺鑰?, '瑙掕壊鏉ユ簮绫诲瀷'];
  up.Origin.TraversalMethod = [鏂规硶涓枃鍚? '绌胯秺鏂瑰紡'];  // 绌胯秺鑰呬笓鐢?  up.Origin.TraversalDesc = [鑷畾涔夋弿杩? '绌胯秺璇︽儏'];   // 鑷畾涔夌┛瓒婁笓鐢?  ```

**淇敼鍘熷洜**锛歄rigin 淇℃伅闇€瑕佸啓鍏?statData 鎵嶈兘琚?CoT 鐨勬棤闄愭搴撲笓椤规鏌ユ楠よ鍙?
**淇敼缁撴灉**锛欰I 鐨勬€濈淮閾惧彲浠ユ纭鍙?`Origin.Type` 鍖哄垎鏈湡/绌胯秺鑰呭彊浜嬫柟寮?
---

## [v0.7] 鈥?涓栫晫閿氱偣鎻愮ず璇嶅鏍囧晢鍩庢槦绾х郴缁燂紙2026-02-26锛?
### 淇敼鏂囦欢
- `src/worldAnchorPrompt.js`
- `server.js`
- `src/worldArchiveStore.js`锛堣緭鍑哄瓧娈垫柊澧烇級

### 淇敼鍐呭

**`worldAnchorPrompt.js`** 瀹屾暣閲嶅啓锛?- 鏂板 `STAR_TIER_TABLE` 甯搁噺锛氬畬鏁?16鈽?鏄熺骇琛紙涓?`shopPrompt.js` 瀹屽叏涓€鑷达級锛屽寘鍚睘鎬у€艰寖鍥淬€佽兘閲忚緭鍑哄弬鑰冦€佺牬鍧忓姏鍙傜収
- 鏃х殑 6 妗ｆ枃瀛楁爣绛撅紙`low/mid/high/stellar/galactic/beyond`锛夋浛鎹负鏁存暟杈撳嚭瀛楁 `worldTier: 0-16`
- 鏂板 `midTier` 瀛楁锛氭櫘閫氶《灏栦粠涓氳€呯殑浠ｈ〃鏄熺骇锛堢敤浜庡畾浠峰熀鍑嗭級
- 鍥涙瀹℃牳鍗忚閲嶆瀯涓轰笁姝?Anti-Feat 鍗忚锛?  - **绗竴姝?*锛氬疄璇佷富涔?+ 鎵掔洅瀛愶紙鍚堝苟锛夆€?鍏堢‘璁ゅ師浣滄槸鍚︾湡瀹炲彂鐢燂紝鍐嶈繕鍘熶负鐗╃悊閲忕骇
  - **绗簩姝?*锛?*閫愬睘鎬у弽鍚戠害鏉?*锛堝鏍囧晢鍩?1A+1B+1C锛夆€?10 椤瑰睘鎬у弻鍚戠害鏉熻〃 + 鎻愮函瑙勫垯 + 鍔熻兘缁村害闄嶇骇琛?  - **绗笁姝?*锛氬弽鍚戝鏌?+ 鎻忚堪鍘婚瓍锛堝悎骞讹級鈥?姣忔潯娉曞垯蹇呴』鏈変笂闄愪緷鎹?- `powerSystems` 姣忎釜浣撶郴鏂板蹇呭～瀛楁 `antiFeatAnchor`锛堝師浣滃疄璇佺殑涓婇檺渚濇嵁锛?- `typicalTierRange/peakTierRange` 鏀逛负浣跨敤 "1-2鈽? 绛変笌鍟嗗煄瀵规爣鐨勬暟鍊艰〃杈?
**`server.js`** 鏇存柊锛?- 涓栫晫妗ｆ鐢熸垚璺敱涓細浼樺厛浠?`worldData.worldTier`锛堟柊鏁存暟瀛楁锛夋帹瀵?`tierRange`锛屽吋瀹规棫鐨勬枃瀛楁爣绛?- 瀛樺偍鏃堕澶栦繚瀛?`worldTier` 鍜?`midTier`
- 妗ｆ鍒楄〃鎺ュ彛杩斿洖 `worldTier` 鍜?`midTier` 瀛楁
- `updateArchive` 鐧藉悕鍗曞鍔?`worldTier/midTier`

**`worldArchiveStore.js`**锛堥棿鎺ワ級锛?- `detectTierRange(maxTier)` 鍑芥暟宸插瓨鍦紝琚?server.js 鐢ㄤ簬浠庢暣鏁版帹瀵兼枃瀛楁爣绛撅紙鍚戝悗鍏煎锛?
### 淇敼鍘熷洜
- 鏃х殑涓栫晫妗ｆ鏄熺骇锛坄low/mid/high` 绛夋枃瀛楁爣绛撅級涓庡晢鍩?16鈽?浣撶郴鏃犳硶瀵瑰簲锛屽鑷村晢鍩庡畾浠风己涔忓弬鑰冧緷鎹?- Anti-Feat 鍙嶅悜绾︽潫鏄晢鍩庤瘎浼扮殑鏍稿績锛屼笘鐣屾。妗堢敓鎴愪篃搴斾娇鐢ㄥ悓鏍风殑涓ユ牸鏂规硶

### 淇敼缁撴灉
- 涓栫晫妗ｆ鏄熺骇杈撳嚭鏁存暟锛?-16鈽咃級锛屼笌鍟嗗煄鍏戞崲绯荤粺瀹屽叏瀵规爣
- 姣忎釜鍔涢噺浣撶郴鏈夊彲楠岃瘉鐨勪笂闄愪緷鎹紙`antiFeatAnchor`锛?- 鏈嶅姟鍣ㄥ悜鍚庡吋瀹规棫鐨勬枃瀛楁爣绛炬牸寮?
---

## [v0.8] 鈥?绋嬪簭鏂囨。鐢熸垚锛?026-02-26锛?
### 鏂板鏂囦欢
- `ARCHITECTURE.md`锛氬畬鏁寸▼搴忔灦鏋勮鏄庯紙鎵€鏈夋枃浠躲€佸嚱鏁般€佽緭鍏ヨ緭鍑恒€佹暟鎹粨鏋勩€佹暟鎹祦閾捐矾锛?- `CHANGELOG.md`锛氭湰鐗堟湰鍙樻洿鏃ュ織锛坴0.1 鑷冲綋鍓嶏級

### 淇敼鍘熷洜
- 鐢ㄦ埛闇€瑕佸畬鏁寸殑鏂囨。鏀寔锛屼究浜庡悗缁紑鍙戝拰鐞嗚В绯荤粺缁撴瀯

---

## 寰呭姙 / 宸茬煡闂

| 鐘舵€?| 鎻忚堪 |
|------|------|
| 鉁?宸蹭慨澶?| 鎬濈淮閾炬湭瀹屽叏鎶樺彔 |
| 鉁?宸蹭慨澶?| UpdateVariable 浣嶇疆閿欒 |
| 鉁?宸蹭慨澶?| 鏃ュ織鍏抽敭鍐呭鍙兘涓㈠け |
| 鉁?宸插疄鐜?| 澶氫笘鐣屼功骞跺彂鍔犺浇 |
| 鉁?宸插疄鐜?| 璐墿杞︽壒閲忓厬鎹?|
| 鉁?宸插疄鐜?| 绌胯秺鏂瑰紡閫夋嫨 |
| 馃搵 寰呭疄鐜?| 涓栫晫妗ｆ缂栬緫椤甸潰锛堢洰鍓嶅彧鑳介€氳繃 API PATCH 淇敼锛?|
| 馃搵 寰呭疄鐜?| 瀛樻。鍒嗙粍/鏍囩绠＄悊 |
| 馃搵 寰呭疄鐜?| 鎵归噺瀵煎叆涓栫晫妗ｆ |

---

## [v0.9] 鈥?鍚庣鏋舵瀯妯″潡鍖栭噸鏋勶紙2026-03 鍓嶏級

### 淇敼鏂囦欢
- `server.js`锛堢簿绠€涓哄叆鍙?+ 渚濊禆娉ㄥ叆锛?- 鏂板 `src/core/`锛坈onfig.js, configLoader.js, session.js, llmClient.js, logger.js, sessionLock.js锛?- 鏂板 `src/engine/`锛坓ameLoop.js, promptBuilder.js, regexPipeline.js, varEngine.js锛?- 鏂板 `src/routes/`锛堟瘡涓姛鑳藉煙鐙珛璺敱鏂囦欢锛?- 鏂板 `src/features/shop/`, `src/features/world/`, `src/features/character/`, `src/features/gacha/`
- 鏂板 `src/content/`锛堝唴缃唴瀹瑰崰浣嶏級

### 淇敼鍐呭
- 灏嗗師 `server.js` 涓墍鏈夐€昏緫鎷嗗垎鍒板悇瀛愭ā鍧?- 鎵€鏈夎矾鐢辨ā鍧楃粺涓€浣跨敤渚濊禆娉ㄥ叆妯″紡 `registerRoutes(app, deps)`
- 浼氳瘽骞跺彂閿佺嫭绔嬩负 `sessionLock.js`

### 淇敼鍘熷洜
- 鍘?server.js 杩囦簬搴炲ぇ锛岄毦浠ョ淮鎶ゅ拰瀹氫綅闂

### 淇敼缁撴灉
- 妯″潡鑱岃矗娓呮櫚锛屼究浜庣嫭绔嬩慨鏀?
---

## [v0.10] 鈥?鎶藉崱绯荤粺锛?026-03 鍓嶏級

### 淇敼鏂囦欢
- 鏂板 `src/features/gacha/gachaEngine.js`
- 鏂板 `src/routes/gachaRoutes.js`

### 淇敼鍐呭
- 瀹炵幇 6 妗ｆ娊鍗℃睜锛坙ow/mid/high/stellar/galactic/beyond锛夛紝pityHard 淇濆簳鍏ㄩ儴璁句负 **100 鎶?*
- `POST /api/sessions/:id/gacha/draw` 绔偣
- 淇鍙傛暟椤哄簭鍜岃繑鍥炲€肩被鍨?bug

### 淇敼鍘熷洜
- 娓告垙闇€瑕佹娊鍗¤幏鍙栫墿鍝佹満鍒?
### 淇敼缁撴灉
- 鎶藉崱姝ｅ父鎵ц锛岀粨鏋滃瓨鍏?Arsenal.GachaPending

---

## [v0.11] 鈥?涓栫晫韬唤缁ф壙閫夐」锛?026-03-13锛?
### 淇敼鏂囦欢
- `src/routes/sessionRoutes.js`
- `src/routes/gameRoutes.js`锛坲se-anchor 绔偣锛?- `src/features/world/worldEngine.js`
- `public/app.js`锛堟柊寤哄瓨妗ｅ悜瀵?+ HUD 閿氱偣鍗★級
- `public/shop.js`锛堝厬鎹㈤敋鐐瑰悗韬唤閫夋嫨寮圭獥锛?
### 淇敼鍐呭
- 鏂板缓瀛樻。鏃讹細姣忎釜涓栫晫涓嬫柟鏄剧ず缁ф壙/涓嶇户鎵垮垏鎹㈡寜閽紝閫氳繃 `worldAnchorOptions[{id, inheritIdentity}]` 浼犻€?- 婵€娲婚敋鐐规椂锛歚POST /api/sessions/:id/use-anchor` 鎺ュ彈 `inheritIdentity` 鍙傛暟
- 鍟嗗煄鍏戞崲閿氱偣鍚庯細绔嬪嵆寮瑰嚭韬唤閫夋嫨寮圭獥锛堢户鎵?/ 澶栨潵鑰?/ 绋嶅悗婵€娲伙級
- `inheritIdentity=false` 鏃讹細WorldIdentity=null锛孡ocation 浣跨敤閫氱敤鎻忚堪锛屾竻闄?CharacterSheet.WorldContext

### 淇敼鍘熷洜
- 鐢ㄦ埛甯屾湜浠ュ鏉ヨ€呰韩浠借繘鍏ヤ笘鐣岋紝涓嶅姞杞藉師鏈変笘鐣岃韩浠?
### 淇敼缁撴灉
- 绌胯秺鏃跺彲閫夋嫨鏄惁缁ф壙涓栫晫韬唤锛岄€夋嫨绔嬪嵆鐢熸晥

---

## [v0.12] 鈥?鎻愮ず璇嶄慨姝ｏ紙2026-03-13锛?
### 淇敼鏂囦欢
- `src/engine/varEngine.js`
- `src/content/worldbook.js`锛堣縼绉诲悗锛?
### 淇敼鍐呭
- Backend Data Stream 鍔犲叆 WORLD RULES ENFORCEMENT 鎸囦护锛氫笘鐣屾硶鍒欓€氳繃鎰熺煡/鏈兘/瑙傚療鍛堢幇锛屼笉鐩存帴鍛藉悕
- 鍑绘潃鎯╃綒鎻忚堪锛氫粠"绯荤粺鏀堕泦鏁版嵁"鏀逛负"鍚岀被鐩爣绉垎杈归檯鏀剁泭浼氳繀閫熶笅闄?

### 淇敼鍘熷洜
- 涓栫晫娉曞垯鍚嶇О鐩存帴鍑虹幇鍦ㄦ鏂囦腑锛涘嚮鏉€鎯╃綒鎺緸涓嶅噯纭?
### 淇敼缁撴灉
- 娉曞垯鏁堟灉鑷劧鍛堢幇锛涚Н鍒嗚“鍑忔弿杩版纭?
---

## [v0.13] 鈥?鍐呭灞傚唴缃?+ 杩愯鏃剁紪杈戝櫒鏀寔锛?026-03-14锛?
### 淇敼鏂囦欢
- `src/content/presets.js`锛?71 鏉℃彁绀鸿瘝锛屽畬鍏ㄦ浛鎹㈠崰浣嶅唴瀹癸級
- `src/content/worldbook.js`锛? 鏉″惈绂佺敤椤癸紝鍚?ENTRIES_RAW + getAllEntries()锛?- `src/content/regex.js`锛?3 鏉″惈绂佺敤椤癸級
- `src/content/charCard.js`锛堝疄闄呰鑹插崱鍐呭锛?- `src/content/index.js`锛堟柊澧?buildPresetSTJson(), getBuiltinWorldbookRaw()锛?- `src/core/config.js`锛坢time 缂撳瓨 + overrides 鏀寔锛屾柊澧?invalidateAssetsCache()锛?- `src/core/configLoader.js`锛堟柊澧?loadPresetFromData()锛?- `src/routes/presetRoutes.js`锛堝畬鍏ㄩ噸鍐欙級
- `src/routes/worldRoutes.js`锛圙ET/POST 閲嶅啓锛?- `server.js`锛坮outeDeps 鎵╁睍锛?- `config.json`锛堟竻绌?charCardPath, presetPath锛?
### 淇敼鍐呭
- 杩佺Щ楠岃瘉锛?71 鏉℃彁绀鸿瘝椤哄簭銆乪nabled銆佸唴瀹逛笌澶栫疆 JSON 瀹屽叏涓€鑷?- `data/content-overrides.json` 浣滀负杩愯鏃惰鐩栧瓨鍌紙preset + worldbook.entries锛?- 缂栬緫鍣?GET/POST 鏀逛负璇诲啓 overrides锛屽厹搴曞埌鍐呯疆 JS 鍐呭
- `loadGameAssets()` 鍔?mtime 缂撳瓨 + overrides 浼樺厛閫昏緫

### 淇敼鍘熷洜
- 涓嶄緷璧栧缃?SillyTavern JSON 鏂囦欢
- 寮€鍙戞椂鏂逛究鍦?src/content/ 涓洿鎺ュ畾浣嶄慨鏀规彁绀鸿瘝
- 杩愯鏃剁紪杈戝櫒淇敼鍚庣珛鍗崇敓鏁堬紝鏃犻渶閲嶅惎

### 淇敼缁撴灉
- 鏈嶅姟鍣ㄥ畬鍏ㄤ娇鐢ㄥ唴缃唴瀹癸紝config.json 璺緞宸叉竻绌?- 缂栬緫鍣ㄥ姛鑳戒笌涔嬪墠瀹屽叏涓€鑷达紙鍐呭缂栬緫/寮€鍏?鎺掑簭/姝ｅ垯鐑噸杞斤級

---

## [v0.14] 鈥?Cursor 瑙勫垯 + 鏂囨。鏇存柊瑙勮寖锛?026-03-14锛?
### 鏂板鏂囦欢
- `.cursor/rules/update-docs.mdc`锛氭瘡娆′唬鐮佷慨鏀瑰悗蹇呴』鍚屾鏇存柊 ARCHITECTURE.md 鍜?CHANGELOG.md

### 淇敼鏂囦欢
- `ARCHITECTURE.md`锛氬畬鍏ㄩ噸鍐欙紝鍙嶆槧褰撳墠妯″潡鍖栨灦鏋勩€佸唴瀹瑰眰鏁版嵁娴併€佹墍鏈夊叧閿嚱鏁板拰鏁版嵁缁撴瀯
- `CHANGELOG.md`锛氳ˉ鍏?v0.9鈥攙0.14 鍙樻洿璁板綍

### 淇敼鍘熷洜
- 鏂囨。鑷?v0.8锛?026-02-26锛変弗閲嶈劚鑺傦紝涓庡綋鍓嶄唬鐮佷笉绗?
### 淇敼缁撴灉
- 鏂囨。鍑嗙‘鍙嶆槧褰撳墠绯荤粺鏋舵瀯鍜屽姛鑳?
---
## [v0.15] 鈥?Phase 4 鎴柇淇 + 缁啓閲嶈瘯锛?026-03-16锛?
### 淇敼鏂囦欢
- \src/core/llmClient.js- \src/engine/gameLoop.js
### 淇敼鍐呭
- \llmClient.js\锛歮axTokens 涓?null/0/undefined 鏃朵笉鍚?API 鍙戦€?max_tokens 瀛楁锛堜笉闄愬埗杈撳嚭闀垮害锛夛紱鏂板 opts.onFinishReason 鍥炶皟锛屽彲鎹曡幏娴佸紡鍝嶅簲鐨?finish_reason
- \gameLoop.js\ Phase 4锛氬幓鎺夌‖缂栫爜鐨?maxTokens: 2048 涓婇檺锛屾敼涓?null锛涙坊鍔犳渶澶?娆＄画鍐欓噸璇曗€斺€旇嫢 UpdateVariable 鏍囩鏈棴鍚堬紝灏嗛儴鍒嗗搷搴斾綔涓?assistant prefill锛岃拷鍔犺缁х画娑堟伅閲嶈皟 LLM

### 淇敼鍘熷洜
- 鏃ュ織涓?Phase 4锛圲pdateVariable锛変粎杈撳嚭 313 瀛楃渚挎埅鏂紝UpdateVariable 鍧楁湭闂悎
- 鍘熸湁 maxTokens: 2048 杩囧皬锛屼笖鏃犲畬鏁存€ф鏌?
### 淇敼缁撴灉
- Phase 4 涓嶅啀鍙?token 涓婇檺绾︽潫
- 鑻ヨ緭鍑轰笉瀹屾暣锛岃嚜鍔ㄧ画鍐欐渶澶?娆★紝纭繚鏍囩瀹屾暣鍖归厤

---


## 寰呭姙 / 宸茬煡闂

| 鐘舵€?| 鎻忚堪 |
|------|------|
| 鉁?宸蹭慨澶?| 鎬濈淮閾炬湭瀹屽叏鎶樺彔 |
| 鉁?宸蹭慨澶?| UpdateVariable 浣嶇疆閿欒 |
| 鉁?宸蹭慨澶?| 鏃ュ織鍏抽敭鍐呭鍙兘涓㈠け |
| 鉁?宸插疄鐜?| 澶氫笘鐣屼功骞跺彂鍔犺浇 |
| 鉁?宸插疄鐜?| 璐墿杞︽壒閲忓厬鎹?|
| 鉁?宸插疄鐜?| 绌胯秺鏂瑰紡閫夋嫨 |
| 鉁?宸插疄鐜?| 涓栫晫韬唤缁ф壙閫夐」 |
| 鉁?宸插疄鐜?| 鍐呭灞傚唴缃紙涓嶄緷璧栧缃枃浠讹級 |
| 鉁?宸插疄鐜?| 杩愯鏃剁紪杈戝櫒鏀寔锛坧reset/worldbook/regex 鐑噸杞斤級 |
| 馃搵 寰呭疄鐜?| 瀛樻。鍒嗙粍/鏍囩绠＄悊 |
| 馃搵 寰呭疄鐜?| 鎵归噺瀵煎叆涓栫晫妗ｆ |

