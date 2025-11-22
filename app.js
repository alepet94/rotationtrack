
        import { app, auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, onSnapshot, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        const QUARTER_DURATIONS_MS = { 'Q1': 600000, 'Q2': 600000, 'Q3': 600000, 'Q4': 600000, 'OT': 300000, '2OT': 300000 };
        const QUARTER_ORDER = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT'];
        const NEXT_QUARTER = { 'Q1': 'Q2', 'Q2': 'Q3', 'Q3': 'Q4', 'Q4': 'OT', 'OT': '2OT' };
        const DEFAULT_QUARTER = 'Q1';
        const GAME_STATE_DOC = 'game_state';

        let gameState = { players: [], isRunning: false, remainingTime: QUARTER_DURATIONS_MS[DEFAULT_QUARTER], lastUpdateTime: 0, currentQuarter: DEFAULT_QUARTER };
        let timerInterval = null, userId = 'anon', isAuthReady = false;
        let selectedPlayerId = null;

        const appId = 'rotation-pro';

        async function initFirebase() {
            try {
                setLogLevel('error');
                onAuthStateChanged(auth, (user) => {
                    if (user) {
                        userId = user.uid;
                        const el = document.getElementById('user-id-display');
                        if (el) el.textContent = `ID: ${userId.substring(0,8)}`;
                        isAuthReady = true;
                        setupRealtimeListener();
                    } else {
                        window.location.href = "login.html";
                    }
                });
            } catch (e) {
                console.error(e);
                showMessage("Errore Connessione.");
            }
        }
        
        async function saveGameState() {
            if (!db || !userId) return;
            const dataToSave = { ...gameState, lastUpdateTime: gameState.isRunning ? Date.now() : gameState.lastUpdateTime };
            try { await setDoc(doc(db, `artifacts/${appId}/users/${userId}/basket_rotations`, GAME_STATE_DOC), dataToSave, { merge: true }); } catch(e) {}
        }

        function setupRealtimeListener() {
            if (!db || !userId) return;
            onSnapshot(doc(db, `artifacts/${appId}/users/${userId}/basket_rotations`, GAME_STATE_DOC), (snap) => {
                if (snap.exists() && snap.data().players) {
                    const loaded = snap.data();
                    gameState = {
                        players: loaded.players || [], isRunning: loaded.isRunning || false,
                        remainingTime: loaded.remainingTime || QUARTER_DURATIONS_MS[DEFAULT_QUARTER],
                        lastUpdateTime: loaded.lastUpdateTime || 0, currentQuarter: loaded.currentQuarter || DEFAULT_QUARTER
                    };
                    syncTimer();
                } else showSetupOrGame(false);
                updateUI();
            });
        }
        
        function syncTimer() {
            clearInterval(timerInterval); timerInterval = null;
            if (gameState.isRunning && gameState.lastUpdateTime > 0) {
                const elapsed = Date.now() - gameState.lastUpdateTime;
                gameState.remainingTime -= elapsed; gameState.lastUpdateTime = Date.now();
                if (gameState.remainingTime <= 0) { 
                    gameState.remainingTime = 0; 
                    // AUTO-SWITCH QUARTER
                    const nextQ = NEXT_QUARTER[gameState.currentQuarter];
                    if (nextQ) {
                        gameState.isRunning = false; // Pause timer
                        const elapsedQ = QUARTER_DURATIONS_MS[gameState.currentQuarter];
                        updateRotationEndTimes(elapsedQ);
                        gameState.currentQuarter = nextQ;
                        gameState.remainingTime = QUARTER_DURATIONS_MS[nextQ];
                        
                        gameState.players.filter(p => p.status === 'court').forEach(p => {
                            let perf = getPerf(p, nextQ);
                            perf.rotations.push({ start: 0, end: null });
                        });
                        saveGameState(); showMessage(`Fine Quarto! Passaggio a ${nextQ}.`);
                    } else { gameState.isRunning = false; }
                } else { timerInterval = setInterval(updateTimer, 100); }
            }
        }

        function showSetupOrGame(exists) {
            // Nuova logica: il gioco è sempre visibile, il modal roster si apre solo su richiesta
            const modal = document.getElementById('setup-modal');
            if (!modal) return;
            modal.classList.add('hidden');
        }
        
        globalThis.initializeGame = async function() {
            const txt = document.getElementById('player-input').value.trim();
            if (!txt) return showMessage("Inserisci giocatori.");
            const lines = txt.split('\n').filter(l => l.trim());
            
            gameState.players = lines.map((l, i) => {
                const m = l.match(/^(\d+)[.\s]+\s*(.*)/);
                const numStr = m ? m[1] : (i + 1).toString();
                const name = m ? m[2].trim() : l.trim();
                return { id: crypto.randomUUID(), number: numStr, name: name || `G${numStr}`, status: i < 5 ? 'court' : 'bench', performance: [] };
            });

            gameState.currentQuarter = DEFAULT_QUARTER; gameState.remainingTime = QUARTER_DURATIONS_MS[DEFAULT_QUARTER];
            gameState.isRunning = false; gameState.lastUpdateTime = 0;
            gameState.players.filter(p => p.status === 'court').forEach(p => p.performance = [{ quarter: DEFAULT_QUARTER, rotations: [{ start: 0, end: null }] }]);
            await saveGameState(); showSetupOrGame(true);
        }

        globalThis.toggleTimer = async function() {
            if (gameState.remainingTime <= 0) { showMessage("Fine quarto."); gameState.isRunning = false; await saveGameState(); return; }
            gameState.isRunning = !gameState.isRunning;
            if (gameState.isRunning) { gameState.lastUpdateTime = Date.now(); timerInterval = setInterval(updateTimer, 100); }
            else clearInterval(timerInterval);
            await saveGameState(); updateUI();
        }

        function updateTimer() {
            if (!gameState.isRunning) return;
            const now = Date.now(); gameState.remainingTime -= (now - gameState.lastUpdateTime); gameState.lastUpdateTime = now;
            if (gameState.remainingTime <= 0) { syncTimer(); }
            updateUI();
        }

        globalThis.resetGame = async function() {
            clearInterval(timerInterval); timerInterval = null;
            gameState.currentQuarter = DEFAULT_QUARTER; gameState.remainingTime = QUARTER_DURATIONS_MS[DEFAULT_QUARTER];
            gameState.isRunning = false; gameState.lastUpdateTime = 0;
            gameState.players = gameState.players.map((p, i) => ({ ...p, status: i<5?'court':'bench', performance: i<5 ? [{ quarter: DEFAULT_QUARTER, rotations: [{start:0, end:null}] }] : [] }));
            await saveGameState(); updateUI();
        }

        globalThis.changeQuarter = async function() {
            const newQ = document.getElementById('quarter-select').value;
            if (newQ === gameState.currentQuarter) return;
            if (gameState.isRunning) await globalThis.toggleTimer();
            const elapsed = QUARTER_DURATIONS_MS[gameState.currentQuarter] - gameState.remainingTime;
            updateRotationEndTimes(elapsed);
            gameState.currentQuarter = newQ; gameState.remainingTime = QUARTER_DURATIONS_MS[newQ];
            gameState.players.filter(p=>p.status==='court').forEach(p => {
                const perf = getPerf(p, gameState.currentQuarter);
                if(!perf.rotations.length || perf.rotations.at(-1).end !== null) perf.rotations.push({start:0, end:null});
            });
            await saveGameState(); updateUI();
        }

        function updateRotationEndTimes(elapsed) {
            gameState.players.filter(p => p.status === 'court').forEach(p => {
                const perf = getPerf(p, gameState.currentQuarter);
                if(perf.rotations.length && perf.rotations.at(-1).end === null) perf.rotations.at(-1).end = elapsed;
            });
        }

        function getPerf(p, q) {
            let perf = p.performance.find(x => x.quarter === q);
            if (!perf) { perf = { quarter: q, rotations: [] }; p.performance.push(perf); }
            return perf;
        }

        globalThis.allowDrop = (ev) => ev.preventDefault();
        globalThis.handleDragStart = (ev, id) => { ev.dataTransfer.setData("pid", id); ev.target.classList.add('is-dragging'); }
        globalThis.handleDragEnd = (ev) => { ev.target.classList.remove('is-dragging'); }
        globalThis.handleDrop = async (ev) => {
            ev.preventDefault(); if (ev.target.closest('.player-card')) return; 
            await processDrop(ev.dataTransfer.getData("pid"), ev.currentTarget.id === 'court-area' ? 'court' : 'bench');
        }
        globalThis.handleDropOnPlayer = async (ev, tid) => {
            ev.preventDefault(); ev.stopPropagation();
            await processSwap(ev.dataTransfer.getData("pid"), tid);
        }
        globalThis.handlePlayerClick = async (ev, id) => {
            ev.stopPropagation();
            if (!selectedPlayerId) { selectedPlayerId = id; updateUI(); return; }
            if (selectedPlayerId === id) { selectedPlayerId = null; updateUI(); return; }
            await processSwap(selectedPlayerId, id); selectedPlayerId = null;
        }
        globalThis.handleAreaClick = async (areaType) => {
            if (selectedPlayerId) { await processDrop(selectedPlayerId, areaType); selectedPlayerId = null; }
        }

        async function processDrop(pid, newStatus) {
            const p = gameState.players.find(x => x.id === pid);
            if (!p || p.status === newStatus) return;
            if (newStatus === 'court' && gameState.players.filter(x => x.status === 'court').length >= 5) return showMessage("Massimo 5 in campo!");
            p.status = newStatus;
            handleSubstitution(p, newStatus==='court'?'bench':'court', newStatus);
            await saveGameState(); updateUI();
        }

        async function processSwap(id1, id2) {
            const p1 = gameState.players.find(x => x.id === id1);
            const p2 = gameState.players.find(x => x.id === id2);
            if (!p1 || !p2 || p1.id === p2.id) return;
            if (p1.status !== p2.status) {
                const bench = p1.status === 'bench' ? p1 : p2;
                const court = p1.status === 'bench' ? p2 : p1;
                bench.status = 'court'; court.status = 'bench';
                handleSubstitution(court, 'court', 'bench'); handleSubstitution(bench, 'bench', 'court');
                await saveGameState(); updateUI();
            } else { showMessage("Scambio valido solo Campo <-> Panchina."); selectedPlayerId = null; updateUI(); }
        }

        function handleSubstitution(p, oldS, newS) {
            const elapsed = QUARTER_DURATIONS_MS[gameState.currentQuarter] - gameState.remainingTime;
            const perf = getPerf(p, gameState.currentQuarter);
            if (oldS === 'court') {
                if(perf.rotations.length && perf.rotations.at(-1).end === null) perf.rotations.at(-1).end = elapsed;
            } else {
                if(!perf.rotations.length || perf.rotations.at(-1).end !== null) perf.rotations.push({start:elapsed, end:null});
            }
        }
        
        function formatTime(ms) { return `${Math.floor(Math.max(0,ms)/60000).toString().padStart(2,'0')}:${Math.floor((Math.max(0,ms)%60000)/1000).toString().padStart(2,'0')}`; }
        function showMessage(t) { document.getElementById('modal-text').textContent = t; document.getElementById('message-modal').classList.remove('hidden'); }
        
        // --- STAT CALCS ---
        function getQuarterOffset(q) {
            let offset = 0;
            for (let prev of QUARTER_ORDER) {
                if (prev === q) break;
                offset += QUARTER_DURATIONS_MS[prev];
            }
            return offset;
        }

        function calcQuarterStats(p, qCode) {
            let tot = 0;
            const qDuration = QUARTER_DURATIONS_MS[qCode];
            const elapsed = (qCode === gameState.currentQuarter) ? (qDuration - gameState.remainingTime) : qDuration;
            const perf = p.performance.find(x => x.quarter === qCode);
            if (!perf) return 0;
            perf.rotations.forEach(r => {
                let end = r.end;
                if (end === null) {
                    if (qCode === gameState.currentQuarter && p.status === 'court') end = elapsed;
                    else end = qDuration; 
                }
                if (end !== null && r.start <= end) tot += (end - r.start);
            });
            return tot;
        }

        function calcGameStats(p) {
            let tot = 0, currentCons = 0;
            const currentQElapsed = QUARTER_DURATIONS_MS[gameState.currentQuarter] - gameState.remainingTime;
            p.performance.forEach(perf => {
                const qd = QUARTER_DURATIONS_MS[perf.quarter];
                perf.rotations.forEach(r => {
                    const isCurrentActive = (p.status === 'court' && r.end === null && perf.quarter === gameState.currentQuarter);
                    const end = isCurrentActive ? currentQElapsed : (r.end === null ? qd : r.end);
                    if(end != null && r.start <= end) tot += (end - r.start);
                });
            });
            if(p.status === 'court') {
                const perf = getPerf(p, gameState.currentQuarter);
                if(perf.rotations.length && perf.rotations.at(-1).end === null) currentCons = currentQElapsed - perf.rotations.at(-1).start;
            }
            return { tot, currentCons };
        }

        function calcRestStats(player) {
            if (player.status === 'court') return 0;
            const currentQ = gameState.currentQuarter;
            const currentElapsed = QUARTER_DURATIONS_MS[currentQ] - gameState.remainingTime;
            const absCurrentTime = getQuarterOffset(currentQ) + currentElapsed;
            let lastExitAbsTime = 0; // Default to 0 (start of game) if never played

            // Iterate backwards to find last rotation end
            const playedQuarters = player.performance.map(p => ({ q: p.quarter, idx: QUARTER_ORDER.indexOf(p.quarter), rotations: p.rotations })).sort((a, b) => b.idx - a.idx);

            for (let p of playedQuarters) {
                if (p.idx > QUARTER_ORDER.indexOf(currentQ)) continue;
                if (p.rotations.length > 0) {
                    const lastRot = p.rotations[p.rotations.length - 1];
                    if (lastRot.end !== null) {
                        lastExitAbsTime = getQuarterOffset(p.q) + lastRot.end;
                        break; 
                    }
                }
            }
            return Math.max(0, absCurrentTime - lastExitAbsTime);
        }

        function updateUI() {
            showSetupOrGame(gameState.players.length > 0); if (!gameState.players.length) return;
            
            const btn = document.getElementById('start-pause-btn');
            btn.textContent = gameState.isRunning ? 'Pausa' : 'Avvia';
            btn.className = gameState.isRunning ? "flex-1 sm:flex-none bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-6 rounded-xl shadow-md active:transform active:scale-95 transition w-28" : "flex-1 sm:flex-none bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-xl shadow-md active:transform active:scale-95 transition w-28";
            
            const td = document.getElementById('timer-display');
            td.textContent = formatTime(gameState.remainingTime);
            td.className = `timer-display ${gameState.remainingTime===0?'text-red-600':(document.documentElement.classList.contains('dark')?'text-white':'text-gray-900')} tabular-nums`;
            document.getElementById('quarter-select').value = gameState.currentQuarter;

            const ca = document.getElementById('court-area'), ba = document.getElementById('bench-area'), sa = document.getElementById('total-stats-area');
            ca.innerHTML=''; ba.innerHTML=''; sa.innerHTML='';

            const sorted = [...gameState.players].sort((a, b) => parseInt(a.number) - parseInt(b.number));

            
        // CARTE GIOCATORI
            sorted.forEach(p => {
                const isCourt = p.status === 'court';
                const stats = calcGameStats(p); 
                const restTime = calcRestStats(p);
                const warn = stats.currentCons > 300000; 
                const isSel = selectedPlayerId === p.id;

                const selCls = isSel ? 'selected-card' : '';
                const cardBg = isCourt ? 'on-court' : 'bg-white dark:bg-gray-800';
                const border = isCourt ? 'border-0' : 'border border-gray-200 dark:border-gray-600';

                const numClass = isCourt ? 'court-number' : 'text-gray-500 dark:text-gray-400';
                const nameClass = isCourt ? 'court-text-primary' : 'text-gray-800 dark:text-white';
                const statsLabel = isCourt ? 'court-text-secondary' : 'text-gray-400';
                const statsVal = isCourt ? 'court-text-primary' : 'text-gray-600 dark:text-gray-300';
                const warnClass = warn ? 'text-red-500 font-bold animate-pulse' : (isCourt ? 'text-white' : 'text-gray-500');

                const roleLabel = (p.role || '').toUpperCase();
                const hasPhoto = p.photoUrl && p.photoUrl.trim() !== '';
                const roleChipClasses = isCourt
                    ? 'bg-white/10 text-white border border-white/30'
                    : 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-500';

                const photoHtml = hasPhoto ? `
                    <div class="h-8 w-8 rounded-full overflow-hidden border border-white/40 bg-black/20 flex-shrink-0">
                        <img src="${p.photoUrl}" alt="${p.name}" class="h-full w-full object-cover" onerror="this.style.display='none'" />
                    </div>
                ` : '';

                const roleHtml = roleLabel ? `
                    <span class="text-[10px] px-2 py-[1px] rounded-full uppercase tracking-wider ${roleChipClasses}">
                        ${roleLabel}
                    </span>
                ` : '';

                const html = `
                <div id="${p.id}" class="player-card flex flex-col justify-between p-3 ${selCls} ${cardBg} ${border} h-32 w-full"
                     draggable="true" ondragstart="handleDragStart(event, '${p.id}')" ondragend="handleDragEnd(event)"
                     ondrop="handleDropOnPlayer(event, '${p.id}')" ondragover="allowDrop(event)"
                     onclick="handlePlayerClick(event, '${p.id}')">

                    <div class="flex justify-between items-start gap-2">
                        <div class="flex items-center gap-2">
                            ${photoHtml}
                            <span class="jersey-number text-2xl ${numClass}">${p.number}</span>
                        </div>
                        <div class="flex flex-col items-end gap-1">
                            ${roleHtml}
                            ${isCourt && warn ? '<span class="animate-pulse text-red-500 text-lg">⚠️</span>' : ''}
                        </div>
                    </div>

                    <div class="font-bold text-base leading-tight line-clamp-2 break-words ${nameClass}">${p.name}</div>

                    <div class="flex justify-between items-end mt-2 text-xs font-medium">
                        <div class="flex flex-col">
                            <span class="uppercase text-[10px] ${statsLabel}">${isCourt ? 'Cons' : 'Riposo'}</span>
                            <span class="font-mono text-sm ${warnClass}">${isCourt ? formatTime(stats.currentCons) : formatTime(restTime)}</span>
                        </div>
                        <div class="flex flex-col items-end">
                            <span class="uppercase text-[10px] ${statsLabel}">Tot (Partita)</span>
                            <span class="font-mono ${statsVal}">${formatTime(stats.tot)}</span>
                        </div>
                    </div>
                </div>`;
                (isCourt ? ca : ba).innerHTML += html;
            });


            // TABELLA STATS
            let tbl = '<table class="w-full text-sm text-left dark:text-gray-300"><thead class="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10 backdrop-blur-sm text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider"><tr><th class="px-4 py-3 font-medium">#</th><th class="px-4 py-3 font-medium">Nome</th><th class="px-4 py-3 font-medium text-right">Q1</th><th class="px-4 py-3 font-medium text-right">Q2</th><th class="px-4 py-3 font-medium text-right">Q3</th><th class="px-4 py-3 font-medium text-right">Q4</th>';
            if (gameState.currentQuarter === 'OT' || gameState.currentQuarter === '2OT') tbl += '<th class="px-4 py-3 font-medium text-right">OT</th>';
            tbl += '<th class="px-4 py-3 font-medium text-right font-bold text-black dark:text-white">Partita</th></tr></thead><tbody>';
            
            sorted.forEach(p => {
                const gameSt = calcGameStats(p);
                tbl += `<tr class="stats-row border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td class="px-4 py-2 font-bold text-gray-900 dark:text-white">${p.number}</td>
                    <td class="px-4 py-2 font-medium">${p.name}</td>
                    <td class="px-4 py-2 text-right font-mono text-gray-500">${formatTime(calcQuarterStats(p, 'Q1'))}</td>
                    <td class="px-4 py-2 text-right font-mono text-gray-500">${formatTime(calcQuarterStats(p, 'Q2'))}</td>
                    <td class="px-4 py-2 text-right font-mono text-gray-500">${formatTime(calcQuarterStats(p, 'Q3'))}</td>
                    <td class="px-4 py-2 text-right font-mono text-gray-500">${formatTime(calcQuarterStats(p, 'Q4'))}</td>`;
                
                if (gameState.currentQuarter === 'OT' || gameState.currentQuarter === '2OT') {
                    tbl += `<td class="px-4 py-2 text-right font-mono text-gray-500">${formatTime(calcQuarterStats(p, 'OT') + calcQuarterStats(p, '2OT'))}</td>`;
                }

                tbl += `<td class="px-4 py-2 text-right font-mono text-blue-600 dark:text-blue-400 font-bold">${formatTime(gameSt.tot)}</td></tr>`;
            });
            sa.innerHTML = tbl + '</tbody></table>';
            if (typeof renderRosterEditor === 'function') renderRosterEditor();
        }

        globalThis.toggleTheme = () => {
            const d = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', d?'dark':'light');
            document.getElementById('sun-icon').classList.toggle('hidden', !d);
            document.getElementById('moon-icon').classList.toggle('hidden', d);
        };
        
        // --- ROSTER EDITOR ---
        function renderRosterEditor() {
            const listEl = document.getElementById('roster-list');
            if (!listEl) return;
            if (!gameState.players || !gameState.players.length) {
                listEl.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400">Nessun giocatore. Aggiungi il roster usando il form qui sopra.</p>';
                return;
            }
            const sorted = [...gameState.players].sort((a, b) => parseInt(a.number || '0') - parseInt(b.number || '0'));
            let html = '';
            sorted.forEach(p => {
                const role = (p.role || '').toUpperCase();
                const imgHtml = p.photoUrl
                    ? `<div class="h-8 w-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0">
                            <img src="${p.photoUrl}" alt="${p.name}" class="h-full w-full object-cover" onerror="this.style.display='none'" />
                       </div>`
                    : `<div class="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 flex-shrink-0">
                            ${p.number || ''}
                       </div>`;
                html += `
                <div class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 mb-1">
                    <div class="flex items-center gap-2">
                        ${imgHtml}
                        <div>
                            <div class="text-xs font-semibold text-gray-900 dark:text-gray-100">${p.number || ''} · ${p.name}</div>
                            <div class="text-[11px] text-gray-500 dark:text-gray-400">${role || '—'}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1">
                        <button class="text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                            onclick="editRosterPlayer('${p.id}')">Modifica</button>
                        <button class="text-[11px] px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-900/40"
                            onclick="deleteRosterPlayer('${p.id}')">✕</button>
                    </div>
                </div>`;
            });
            listEl.innerHTML = html;
        }

        globalThis.openRosterEditor = function() {
            if (!isAuthReady) return;
            const modal = document.getElementById('setup-modal');
            if (!modal) return;
            if (gameState.isRunning) {
                showMessage("Metti in pausa o resetta la partita per modificare il roster.");
                return;
            }
            modal.classList.remove('hidden');
            renderRosterEditor();
        };

        globalThis.closeRosterEditor = function() {
            const modal = document.getElementById('setup-modal');
            if (!modal) return;
            if (!gameState.players || !gameState.players.length) {
                showMessage("Aggiungi almeno un giocatore al roster.");
                return;
            }
            modal.classList.add('hidden');
        };

        globalThis.savePlayerFromForm = async function() {
            const numEl = document.getElementById('roster-number');
            const nameEl = document.getElementById('roster-name');
            const roleEl = document.getElementById('roster-role');
            const photoEl = document.getElementById('roster-photo');

            if (!numEl || !nameEl || !roleEl || !photoEl) return;

            const number = numEl.value.trim();
            const name = nameEl.value.trim();
            const role = roleEl.value;
            const photoUrl = photoEl.value.trim();

            if (!number || !name) {
                showMessage("Inserisci almeno numero e nome del giocatore.");
                return;
            }

            // Cerca se esiste già (stesso id nel campo nascosto oppure stesso numero)
            const editingId = numEl.dataset.editingId || null;
            let player;
            if (editingId) {
                player = gameState.players.find(p => p.id === editingId);
            }

            if (player) {
                player.number = number;
                player.name = name;
                player.role = role;
                player.photoUrl = photoUrl;
            } else {
                const existingSameNumber = gameState.players.find(p => (p.number || '') === number);
                if (existingSameNumber) {
                    showMessage("Esiste già un giocatore con questo numero. Modificalo oppure scegli un altro numero.");
                    return;
                }
                gameState.players.push({
                    id: crypto.randomUUID(),
                    number,
                    name,
                    role,
                    photoUrl,
                    status: 'bench',
                    performance: []
                });
            }

            numEl.value = '';
            nameEl.value = '';
            roleEl.value = '';
            photoEl.value = '';
            delete numEl.dataset.editingId;

            await saveGameState();
            updateUI();
            renderRosterEditor();
        };

        globalThis.editRosterPlayer = function(id) {
            const p = gameState.players.find(x => x.id === id);
            if (!p) return;
            const numEl = document.getElementById('roster-number');
            const nameEl = document.getElementById('roster-name');
            const roleEl = document.getElementById('roster-role');
            const photoEl = document.getElementById('roster-photo');
            if (!numEl || !nameEl || !roleEl || !photoEl) return;

            numEl.value = p.number || '';
            nameEl.value = p.name || '';
            roleEl.value = p.role || '';
            photoEl.value = p.photoUrl || '';
            numEl.dataset.editingId = p.id;
        };

        globalThis.deleteRosterPlayer = async function(id) {
            gameState.players = gameState.players.filter(p => p.id !== id);
            await saveGameState();
            updateUI();
            renderRosterEditor();
        };

        globalThis.resetRoster = async function() {
            if (!confirm("Sicuro di voler svuotare completamente il roster?")) return;
            gameState.players = [];
            await saveGameState();
            updateUI();
            renderRosterEditor();
        };

        if(localStorage.getItem('theme')==='dark') globalThis.toggleTheme();

        window.onload = initFirebase;
    