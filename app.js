// Initialize Icons
lucide.createIcons();

// Setup Chart.js defaults for Dark Theme
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = 'rgba(48, 54, 61, 0.5)';

/* ==================
   FIREBASE CLOUD SYS
   ================== */
const firebaseConfig = {
  apiKey: "AIzaSyBc2fnUmZCtG7XZMBu3QYsE2XhldwHgQtI",
  authDomain: "budget-app-526a8.firebaseapp.com",
  projectId: "budget-app-526a8",
  storageBucket: "budget-app-526a8.firebasestorage.app",
  messagingSenderId: "924845005515",
  appId: "1:924845005515:web:975afb191aeb6736e2d94e",
  measurementId: "G-NX6CFZRCQ0"
};

// Initialize Firebase App explicitly 
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const dbCloud = firebase.firestore();

let currentUser = null;

// Table States
let editingTxId = null;
let txSortBy = 'date';
let txSortDesc = true;
let txSearchText = '';
let txFilterAcc = 'all';

// Handle Auth View Routing
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('app-view').style.display = 'block';
        document.getElementById('auth-email-display').innerText = user.email;

        // Pull active cloud state
        try {
            const doc = await dbCloud.collection('users').doc(user.uid).get();
            if(doc.exists) {
                const cloudData = doc.data();
                db.accounts = cloudData.accounts || [];
                db.transactions = cloudData.transactions || [];
                db.stocks = cloudData.stocks || [];
            }
        } catch(e) { console.error("Cloud fetch fail:", e); }
        
        renderAll(); // Only render after cloud boot
        bindCardMockupEngine();
    } else {
        if(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') {
            console.warn("Dev Environment Detected - Bypassing Google Auth");
            currentUser = { uid: 'LOCAL_DEV_MODE', email: 'dev@localhost' };
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('app-view').style.display = 'block';
            document.getElementById('auth-email-display').innerText = 'dev@localhost (Offline Developer Mode)';
            renderAll();
            return;
        }

        currentUser = null;
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('app-view').style.display = 'none';
    }
});

document.getElementById('google-login-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => {
        alert("Login block: " + err.message);
    });
});

window.signOut = function() {
    auth.signOut();
}


/* ==================
   DATA SEEDING & STATE
   ================== */
const SEED_ACCOUNTS = [
    { id: 'A1', name: 'Sample Credit Card 1', type: 'Credit', limit: 50000, apr: 19.99 },
    { id: 'A2', name: 'Sample Credit Card 2', type: 'Credit', limit: 10000, apr: 22.99 },
    { id: 'A3', name: 'Sample Checking', type: 'Debit' }
];

const SEED_STOCKS = [
    { id: 'S1', symbol: 'VT', desc: 'Vanguard Total World Stock', qty: 10.0, price: 100.00, cost: 950 },
    { id: 'S2', symbol: 'VTI', desc: 'Vanguard Total Stock Market', qty: 5.0, price: 250.00, cost: 1200 }
];

const SEED_TRANSACTIONS = [];

function loadData(key, fallback) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
}

let db = {
    accounts: loadData('app_accounts', SEED_ACCOUNTS),
    transactions: loadData('app_tx_v2', SEED_TRANSACTIONS),
    stocks: loadData('app_stocks', SEED_STOCKS)
};

function saveAll() {
    localStorage.setItem('app_tx_v2', JSON.stringify(db.transactions));
    localStorage.setItem('app_accounts', JSON.stringify(db.accounts));
    localStorage.setItem('app_stocks', JSON.stringify(db.stocks));
    if (currentUser && currentUser.uid !== 'LOCAL_DEV_MODE') {
        dbCloud.collection('users').doc(currentUser.uid).set({
            accounts: db.accounts,
            transactions: db.transactions,
            stocks: db.stocks
        }).catch(err => console.error("Failed to Sync:", err));
    }
}

/* ==================
   UTILITIES
   ================== */
function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}
function formatBytes(bytes) {
    if(bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function formatDate(isoStr) { 
    return new Date(isoStr).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
}
function getDayOfWeek(isoStr) {
    return new Date(isoStr).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
}
function getAccountName(id) {
    const acc = db.accounts.find(a => a.id === id);
    return acc ? acc.name : 'Deleted Account';
}

/* ==================
   DOM & TABS
   ================== */
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
        renderAll();
    });
});

window.toggleTransferMode = function(isTransferMode) {
    const viewNorm = document.getElementById('view-normal-transaction');
    const viewTrx = document.getElementById('view-transfer-transaction');
    if(isTransferMode) {
        viewNorm.style.display = 'none';
        viewTrx.style.display = 'block';
    } else {
        viewNorm.style.display = 'block';
        viewTrx.style.display = 'none';
    }
}

// Ensure proper initial state for date pickers
document.getElementById('txn-date').valueAsDate = new Date();
document.getElementById('trf-date').valueAsDate = new Date();

let runningChartInstance = null;

/* ==================
   RENDERING
   ================== */
function renderAll() {
    renderAccounts();  // Builds dropdowns
    renderTransactions();
    renderRunnerAndDashboard();
    renderStocks();
    bindCardMockupEngine();
    updateActiveCardMockup();
    lucide.createIcons();
}

function renderAccounts() {
    const actDropdownOptions = db.accounts.map(acc => `<option value="${acc.id}">${acc.name} (${acc.type})</option>`).join('');
    document.getElementById('txn-account').innerHTML = actDropdownOptions;
    document.getElementById('trf-from').innerHTML = actDropdownOptions;
    document.getElementById('trf-to').innerHTML = actDropdownOptions;

    const balances = {};
    db.accounts.forEach(a => balances[a.id] = 0);
    db.transactions.forEach(tx => {
        if(balances[tx.accountId] !== undefined) {
            balances[tx.accountId] += parseFloat(tx.amount);
        }
    });

    document.getElementById('debit-accounts-list').innerHTML = db.accounts.filter(a => a.type === 'Debit').map(acc => `
        <tr>
            <td><strong>${acc.name}</strong></td>
            <td class="text-right text-white font-weight-bold">${formatCurrency(balances[acc.id])}</td>
            <td><button class="delete-btn" onclick="deleteAccount('${acc.id}')"><i data-lucide="trash-2"></i></button></td>
        </tr>
    `).join('');

    document.getElementById('credit-accounts-list').innerHTML = db.accounts.filter(a => a.type === 'Credit').map(acc => {
        // Compute next statement date
        let stmtDisplay = '<span style="color:var(--text-secondary);">—</span>';
        if (acc.statementDay) {
            const today = new Date();
            let nextStmt = new Date(today.getFullYear(), today.getMonth(), acc.statementDay);
            if (nextStmt <= today) {
                nextStmt = new Date(today.getFullYear(), today.getMonth() + 1, acc.statementDay);
            }
            const daysUntil = Math.ceil((nextStmt - today) / (1000 * 60 * 60 * 24));
            const dateStr = nextStmt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const urgencyColor = daysUntil <= 3 ? '#ff5000' : daysUntil <= 7 ? '#f7971e' : 'var(--text-secondary)';
            stmtDisplay = `<span style="font-weight:600; color:${urgencyColor};">${dateStr}</span><br><small style="color:var(--text-secondary);">${daysUntil}d away</small>`;
        }
        return `
        <tr>
            <td><strong>${acc.name}</strong><br><small class="text-subtle">APR: ${acc.apr}%</small></td>
            <td>${acc.limit === 999999 ? 'No Preset Limit' : formatCurrency(acc.limit)}</td>
            <td>${stmtDisplay}</td>
            <td class="text-right ${balances[acc.id] < 0 ? 'amount-neg' : ''}">${formatCurrency(Math.abs(balances[acc.id]))} Owed</td>
            <td><button class="delete-btn" onclick="deleteAccount('${acc.id}')"><i data-lucide="trash-2"></i></button></td>
        </tr>`;
    }).join('');
}

// === TRANSACTION DOM & FILTER LOGIC === //
function renderTransactions() {
    const list = document.getElementById('tx-log-list');
    
    // Sort logic
    let sortedTx = [...db.transactions];
    sortedTx.sort((a, b) => {
        if (txSortBy === 'date') {
            return txSortDesc ? new Date(b.date) - new Date(a.date) : new Date(a.date) - new Date(b.date);
        } else if (txSortBy === 'amount') {
            return txSortDesc ? b.amount - a.amount : a.amount - b.amount;
        }
        return 0;
    });

    // Filter Logic
    if(txFilterAcc !== 'all') {
        sortedTx = sortedTx.filter(t => t.accountId === txFilterAcc);
    }
    if(txSearchText !== '') {
        const query = txSearchText.toLowerCase();
        sortedTx = sortedTx.filter(t => 
            (t.desc && t.desc.toLowerCase().includes(query)) || 
            (t.category && t.category.toLowerCase().includes(query))
        );
    }

    list.innerHTML = sortedTx.map(tx => {
        const amtCls = tx.amount > 0 ? 'amount-pos' : 'amount-neg';
        const recurBadge = (tx.recur && tx.recur !== 'none') ? `<span style="font-size:0.7rem; background:#161b22; padding:0.1rem 0.3rem; border-radius:3px; margin-left:0.5rem; color:var(--accent);"><i data-lucide="repeat" style="width:10px;height:10px;"></i> ${tx.recur}</span>` : '';
        return `
        <tr>
            <td class="text-center"><input type="checkbox" ${tx.reconcile ? 'checked' : ''} onclick="toggleReconcile('${tx.id}')"></td>
            <td>${formatDate(tx.date)}</td>
            <td><span title="${tx.accountId}">${getAccountName(tx.accountId)}</span></td>
            <td><span class="text-subtle">${tx.category || 'Other'}</span></td>
            <td>${tx.desc} ${recurBadge}</td>
            <td class="text-right ${amtCls}">${formatCurrency(tx.amount)}</td>
            <td class="text-right" style="white-space: nowrap;">
                <button class="delete-btn" style="margin-right:0.5rem;" onclick="openCalendar('${tx.id}')" title="View Calendar"><i data-lucide="calendar"></i></button>
                <button class="delete-btn" style="margin-right:0.5rem;" onclick="editTx('${tx.id}')" title="Edit"><i data-lucide="edit-2"></i></button>
                <button class="delete-btn" onclick="deleteTx('${tx.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>
        `;
    }).join('');

    // Update the Filter Select dropdown options without overwriting current selection
    const filterSelect = document.getElementById('tx-filter-acc');
    const currVal = filterSelect ? filterSelect.value : 'all';
    if(filterSelect) {
        filterSelect.innerHTML = `<option value="all">All Accounts</option>` + db.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        filterSelect.value = currVal;
    }
}

window.filterTransactions = function() {
    txSearchText = document.getElementById('tx-search').value;
    txFilterAcc = document.getElementById('tx-filter-acc').value;
    renderTransactions();
    lucide.createIcons();
};

window.sortTransactions = function(col) {
    if(txSortBy === col) {
        txSortDesc = !txSortDesc;
    } else {
        txSortBy = col;
        txSortDesc = true;
    }
    renderTransactions();
    lucide.createIcons();
};

function getProjectedTransactions() {
    const projected = [];
    let maxTime = Date.now();
    db.transactions.forEach(t => {
        const time = new Date(t.date).getTime();
        if(time > maxTime) maxTime = time;
    });
    // Cast horizon to exactly 1 year out
    const horizon = maxTime + (365 * 24 * 60 * 60 * 1000); 

    db.transactions.forEach(tx => {
        projected.push(tx);

        if (tx.recur && tx.recur !== 'none') {
            let cursor = new Date(tx.date);
            cursor.setHours(12,0,0,0);
            
            while(true) {
                if (tx.recur === 'weekly') cursor.setDate(cursor.getDate() + 7);
                else if (tx.recur === 'biweekly') cursor.setDate(cursor.getDate() + 14);
                else if (tx.recur === 'monthly') cursor.setMonth(cursor.getMonth() + 1);
                else if (tx.recur === 'yearly') cursor.setFullYear(cursor.getFullYear() + 1);

                if (cursor.getTime() > horizon) break;
                
                projected.push({
                    ...tx,
                    id: tx.id + '_G' + cursor.getTime(),
                    date: cursor.toISOString().split('T')[0]
                });
            }
        }
    });
    return projected;
}

function renderRunnerAndDashboard() {
    const debitMap = new Set(db.accounts.filter(a => a.type === 'Debit').map(a => a.id));
    
    // Group tx by date but KEEP individual tx arrays
    const dailyTxMap = {};
    const categoriesPivot = {};
    
    let totalDebitBalance = 0;
    let totalCreditBalance = 0;

    // Use Set to reliably track max columns needed later
    let maxTxCols = 0;
    let earliestDate = null;
    let latestDate = null;

    const projectedDB = getProjectedTransactions();

    projectedDB.forEach(tx => {
        const amt = parseFloat(tx.amount);
        
        const txTime = new Date(tx.date).getTime();
        const isPastOrToday = txTime <= Date.now();

        // Track boundaries
        if (!earliestDate || txTime < earliestDate) earliestDate = txTime;
        if (!latestDate || txTime > latestDate) latestDate = txTime;
        
        // Pivot table logic — include ALL real (non-ghost) transactions, past and future
        const cat = tx.category || 'Other';
        if(cat !== 'Transfer' && cat !== 'Working Capital Seed' && !tx._isProjected) {
            if (!categoriesPivot[cat]) categoriesPivot[cat] = 0;
            categoriesPivot[cat] += amt;
        }

        if (debitMap.has(tx.accountId)) {
            if (isPastOrToday) totalDebitBalance += amt;
        } else {
            if (isPastOrToday) totalCreditBalance += amt;
        }

        // Record ALL transactions into the projected Runner grid/chart
        if (!dailyTxMap[tx.date]) dailyTxMap[tx.date] = [];
        dailyTxMap[tx.date].push({
            id: tx._parentId || tx.id,
            desc: tx.desc,
            amount: amt,
            category: tx.category,
            accountId: tx.accountId,
            date: tx.date,
            isGhost: tx._isProjected || false
        });
        
        if(dailyTxMap[tx.date].length > maxTxCols) {
            maxTxCols = dailyTxMap[tx.date].length;
        }
    });

    document.getElementById('total-debit').innerText = formatCurrency(totalDebitBalance);
    document.getElementById('total-credit').innerText = formatCurrency(Math.abs(totalCreditBalance));
    document.getElementById('working-capital').innerText = formatCurrency(totalDebitBalance + totalCreditBalance);

    // Continuous Runner Build
    const chartLabels = [];
    const chartData = [];
    let runningCap = 0;
    const runnerRowsAsc = [];

    if (earliestDate && latestDate) {
        // Round to midnight UTC-agnostic to prevent loop infinite/off by ones
        const start = new Date(earliestDate);
        start.setHours(12,0,0,0);
        const end = new Date(latestDate);
        end.setHours(12,0,0,0);

        let iter = new Date(start);
        
        // Ensure at least 1 day
        if (end < iter) end.setTime(iter.getTime());

        while (iter <= end) {
            const dateStr = iter.toISOString().split('T')[0]; // YYYY-MM-DD
            
            let todaysTxs = dailyTxMap[dateStr] || [];
            
            let todaysNet = 0;
            todaysTxs.forEach(t => todaysNet += t.amount);
            
            runningCap += todaysNet;

            runnerRowsAsc.push({
                date: dateStr,
                cap: runningCap,
                txs: todaysTxs
            });
            
            chartLabels.push(formatDate(dateStr));
            chartData.push(runningCap);
            
            // Advance one day safely
            iter.setDate(iter.getDate() + 1);
        }
    }

    // Header Construction
    let headerHTML = '<tr><th>Working Capital</th><th>Date</th><th style="min-width:100px;">Day of week</th>';
    for (let c=0; c < (maxTxCols === 0 ? 1 : maxTxCols); c++) {
        headerHTML += `<th>Transaction ${c+1}</th>`;
    }
    headerHTML += '</tr>';
    document.getElementById('runner-header').innerHTML = headerHTML;

    // Table class adjustments setup on index.html but we enforce it here if replacing wasn't perfect
    document.getElementById('runner-list').parentElement.classList.add('excel-table');

    // Display rows (Top to Bottom: Earliest to Latest to match spreadsheet normally, or descending? 
    // Usually spreadsheet runners go chronological A->Z down the rows. 
    // We will render chronological (Earliest on top) since that replicates the Google Sheet exact flow)
    document.getElementById('runner-list').innerHTML = runnerRowsAsc.map(r => {
        const dateObj = new Date(r.date + "T12:00:00");
        const dayWord = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
        
        const dateDisplay = dateObj.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const dayClass = isWeekend ? 'cell-wkend' : 'cell-wkday';

        let rowHTML = `<tr>
            <td class="cell-cap hover-highlight" style="cursor:pointer; text-decoration: underline dotted; text-underline-offset: 3px;" onclick="openCapSnapshot('${r.date}')" title="Click to see account breakdown">${formatCurrency(r.cap)}</td>
            <td style="text-align: right; background: #fff; color: #000; padding: 0.1rem 0.5rem; font-size:0.8rem;">${dateDisplay}</td>
            <td class="${dayClass}">${dayWord}</td>`;
        
        let txCells = '';
        for (let c=0; c < Math.max(1, maxTxCols); c++) {
            if (c < r.txs.length) {
                const tObj = r.txs[c];
                const cls = tObj.amount >= 0 ? 'cell-pos' : 'cell-neg';
                const encObj = encodeURIComponent(JSON.stringify(tObj)).replace(/'/g, "%27");
                txCells += `<td class="${cls} hover-highlight" style="cursor:pointer;" onclick="openTxDetail('${encObj}')" title="Click to view details">${formatCurrency(tObj.amount)}</td>`;
            } else {
                txCells += `<td class="cell-empty">-</td>`;
            }
        }
        
        return rowHTML + txCells + `</tr>`;
    }).join('');

    // Pivot Table rendering
    const pivotHTML = Object.keys(categoriesPivot).sort((a,b) => categoriesPivot[a] - categoriesPivot[b]).map(cat => {
        const val = categoriesPivot[cat];
        return `
        <tr>
            <td>${cat}</td>
            <td class="text-right ${val > 0 ? 'amount-pos' : 'amount-neg'}">${formatCurrency(Math.abs(val))}</td>
        </tr>`;
    }).join('');
    document.getElementById('category-pivot-list').innerHTML = pivotHTML || '<tr><td colspan="2" class="text-center">No categorised data</td></tr>';

    // Build Chart using Chart.js
    const pxPerPoint = 15;
    let targetWidth = chartLabels.length * pxPerPoint;
    const container = document.getElementById('chart-scroll-container');
    const containerWidth = container.clientWidth;
    if (targetWidth < containerWidth) targetWidth = containerWidth;
    if (targetWidth > 32000) targetWidth = 32000; // Hard canvas limit

    document.getElementById('chart-inner-wrap').style.width = targetWidth + 'px';

    const ctx = document.getElementById('cashFlowChart').getContext('2d');
    if (runningChartInstance) {
        runningChartInstance.destroy(); // destroy old chart before re-render
    }
    
    // Robinhood / Apple Maps aesthetic logic
    const startVal = chartData[0] || 0;
    const endVal = chartData[chartData.length - 1] || 0;
    const isPositive = endVal >= startVal;
    
    // Neon Green if trending up, Neon Orange/Red if trending down
    const themeColor = isPositive ? '#00c805' : '#ff5000'; 
    const rgbaColor = isPositive ? 'rgba(0, 200, 5, ' : 'rgba(255, 80, 0, ';
    
    // Create subtle gradient fill to floor
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, rgbaColor + '0.3)');
    gradient.addColorStop(1, rgbaColor + '0.0)');

    // Let Chart.js auto-scale naturally to emphasize slight changes in data
    const maxData = Math.max(...chartData);
    const minData = Math.min(...chartData);

    runningChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Working Capital',
                data: chartData,
                borderColor: themeColor,
                backgroundColor: gradient,
                borderWidth: 2.5,
                pointRadius: 0, // Hide points for clean line look
                pointHoverRadius: 6,
                pointHoverBackgroundColor: themeColor,
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2,
                fill: true,
                tension: 0.1 // Very slight tension for Apple-style smoothing
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onHover: (event, activeElements) => {
                const titleEl = document.getElementById('chart-scrub-title');
                const valEl = document.getElementById('chart-scrub-val');
                const diffEl = document.getElementById('chart-scrub-diff');
                
                const trgtDate = document.getElementById('txn-date').value; // fallback
                const todayTempObj = new Date();
                const tYear = todayTempObj.getFullYear();
                const tMonth = String(todayTempObj.getMonth()+1).padStart(2,'0');
                const tDay = String(todayTempObj.getDate()).padStart(2,'0');
                const targetFmt = formatDate(`${tYear}-${tMonth}-${tDay}`);
                
                let tIdx = chartLabels.findIndex(l => l === targetFmt);
                tIdx = tIdx >= 0 ? tIdx : 0;
                let referenceVal = chartData[tIdx] !== undefined ? chartData[tIdx] : (chartData[0] || 0);

                if (activeElements.length > 0) {
                    const idx = activeElements[0].index;
                    const hoveredValue = chartData[idx];
                    const diff = hoveredValue - referenceVal;
                    const percentDiff = referenceVal !== 0 ? ((diff / Math.abs(referenceVal)) * 100).toFixed(2) : 0;
                    
                    const sign = diff >= 0 ? '+' : '';
                    const colorClass = diff >= 0 ? '#00c805' : '#ff5000';

                    titleEl.innerText = chartLabels[idx];
                    valEl.innerText = formatCurrency(hoveredValue);
                    diffEl.innerHTML = `<span style="color: ${colorClass}">${sign}${formatCurrency(diff)} (${sign}${percentDiff}%)</span> <span style="font-weight:normal;">from Today</span>`;
                } else {
                    titleEl.innerText = 'Working Capital Projection';
                    valEl.innerText = formatCurrency(referenceVal);
                    diffEl.innerHTML = `Interactive Time Series Base`;
                }
            },
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111418',
                    titleColor: '#888',
                    bodyColor: '#fff',
                    bodyFont: { size: 15, weight: 'bold' },
                    displayColors: false,
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: { 
                    display: false,
                    min: minData === maxData ? minData - 100 : minData - Math.abs((maxData - minData) * 0.1),
                    max: minData === maxData ? maxData + 100 : maxData + Math.abs((maxData - minData) * 0.1)
                }, // Completely hide axes for Robinhood aesthetic but enforce explicit tight scaling
                x: { 
                    display: true,
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.4)',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12
                    }
                }
            },
            layout: {
                padding: { top: 15, bottom: 5 }
            }
        }
    });

    // Auto-scroll to Today
    const todayObj = new Date();
    const tLocYear = todayObj.getFullYear();
    const tLocMonth = String(todayObj.getMonth()+1).padStart(2, '0');
    const tLocDay = String(todayObj.getDate()).padStart(2, '0');
    const targetFormattedDate = formatDate(`${tLocYear}-${tLocMonth}-${tLocDay}`);

    const todayIdx = chartLabels.findIndex(l => l === targetFormattedDate);
    const baselineIdx = todayIdx >= 0 ? todayIdx : 0;
    
    // Set initial scrub title statically to match Today's reality
    document.getElementById('chart-scrub-title').innerText = 'Working Capital Projection';
    document.getElementById('chart-scrub-val').innerText = formatCurrency(chartData[baselineIdx] || 0);
    document.getElementById('chart-scrub-diff').innerHTML = `Interactive Time Series Base`;

    if (todayIdx > 0) {
        const scrollAmount = (todayIdx / chartLabels.length) * targetWidth;
        setTimeout(() => {
            container.scrollLeft = scrollAmount - (containerWidth / 2) + 50; 
        }, 50);
    }
}

function renderStocks() {
    let totalMarketValue = 0;
    document.getElementById('stocks-list').innerHTML = db.stocks.map(s => {
        const mktVal = s.qty * s.price;
        const gainLoss = mktVal - s.cost;
        const glClass = gainLoss >= 0 ? 'amount-pos' : 'amount-neg';
        totalMarketValue += mktVal;
        
        return `
        <tr>
            <td><strong>${s.symbol}</strong><br><small class="text-subtle">${s.desc}</small></td>
            <td>${s.qty}</td>
            <td>${formatCurrency(s.cost)}</td>
            <td class="text-right font-weight-bold" style="color:#fff;">${formatCurrency(mktVal)}</td>
            <td class="text-right ${glClass}">${gainLoss >= 0 ? '+' : ''}${formatCurrency(gainLoss)}</td>
            <td><button class="delete-btn" onclick="deleteStock('${s.id}')"><i data-lucide="trash-2"></i></button></td>
        </tr>
        `;
    }).join('');
    
    document.getElementById('total-stocks').innerText = formatCurrency(totalMarketValue);
}

/* ==================
   INTERACTIONS
   ================== */

// TRANSACTIONS
document.getElementById('transaction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const rawAmount = Math.abs(parseFloat(document.getElementById('txn-amount').value));
    const isExpense = document.getElementById('type-expense').checked;
    
    const txPayload = {
        date: document.getElementById('txn-date').value,
        accountId: document.getElementById('txn-account').value,
        category: document.getElementById('txn-category').value,
        recur: document.getElementById('txn-recur').value,
        amount: isExpense ? -rawAmount : rawAmount,
        desc: document.getElementById('txn-desc').value,
        reconcile: editingTxId ? (db.transactions.find(t=>t.id===editingTxId)?.reconcile || false) : false
    };

    if(editingTxId) {
        // Overwrite
        const index = db.transactions.findIndex(t => t.id === editingTxId);
        if(index > -1) {
            txPayload.id = editingTxId;
            db.transactions[index] = txPayload;
        }
        cancelEditTx(); // Reset UI Mode
    } else {
        // Create
        txPayload.id = 'T' + Date.now();
        db.transactions.push(txPayload);
        e.target.reset();
        document.getElementById('type-expense').checked = true; // explicitly reset toggle
    }
    
    saveAll();
    renderAll();
});

// TRANSFERS
document.getElementById('transfer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const trfDate = document.getElementById('trf-date').value;
    const fromAcc = document.getElementById('trf-from').value;
    const toAcc = document.getElementById('trf-to').value;
    const amount = Math.abs(parseFloat(document.getElementById('trf-amount').value));

    if(fromAcc === toAcc) {
        alert("Cannot transfer to the same account.");
        return;
    }

    const tId = Date.now();
    // Outflow
    db.transactions.push({
        id: 'T' + tId + '_OUT',
        date: trfDate,
        accountId: fromAcc,
        category: 'Transfer',
        amount: -amount,
        desc: 'Transfer out to ' + getAccountName(toAcc),
        reconcile: true
    });
    // Inflow
    db.transactions.push({
        id: 'T' + tId + '_IN',
        date: trfDate,
        accountId: toAcc,
        category: 'Transfer',
        amount: amount,
        desc: 'Transfer in from ' + getAccountName(fromAcc),
        reconcile: true
    });

    saveAll();
    document.getElementById('transfer-form').reset();
    document.getElementById('trf-date').valueAsDate = new Date();
    renderAll();
    
    alert("Transfer successfully processed!");
});

window.deleteTx = function(id) {
    db.transactions = db.transactions.filter(t => t.id !== id);
    if(editingTxId === id) cancelEditTx(); // Clear edit state if deleting active edited item
    saveAll(); renderAll();
};

window.toggleReconcile = function(id) {
    const tx = db.transactions.find(t => t.id === id);
    if(tx) {
        tx.reconcile = !tx.reconcile;
        saveAll(); 
        // No need to renderAll, checkbox visually maintains its state locally unless user reloads
    }
};

// EDIT STATE CONTROLLER
window.editTx = function(id) {
    const tx = db.transactions.find(t => t.id === id);
    if(!tx) return;

    // Switch to manual log mode if we are in transfer mode
    if(document.getElementById('view-transfer-transaction').style.display !== 'none') {
        toggleTransferMode(false);
    }

    editingTxId = id;
    document.getElementById('txn-date').value = tx.date;
    document.getElementById('txn-account').value = tx.accountId;
    document.getElementById('txn-category').value = tx.category;
    document.getElementById('txn-recur').value = tx.recur || 'none';
    document.getElementById('txn-amount').value = Math.abs(tx.amount);
    document.getElementById(tx.amount < 0 ? 'type-expense' : 'type-income').checked = true;
    document.getElementById('txn-desc').value = tx.desc;

    // Update UI Buttons
    document.getElementById('btn-submit-tx').innerHTML = 'Update Transaction <i data-lucide="check"></i>';
    document.getElementById('btn-cancel-edit').style.display = 'block';

    // Scroll to form smoothly
    document.getElementById('view-normal-transaction').scrollIntoView({behavior: 'smooth'});
    lucide.createIcons();
};

window.cancelEditTx = function() {
    editingTxId = null;
    document.getElementById('transaction-form').reset();
    document.getElementById('type-expense').checked = true;
    document.getElementById('txn-recur').value = 'none';
    document.getElementById('btn-submit-tx').innerHTML = 'Log Transaction <i data-lucide="plus"></i>';
    document.getElementById('btn-cancel-edit').style.display = 'none';
    lucide.createIcons();
};

// SETTINGS: Export / Import
window.exportData = function() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `budget_backup_${new Date().toISOString().split('T')[0]}.json`);
    dlAnchorElem.click();
};

window.handleImport = function(event) {
    const file = event.target.files[0];
    if(!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if(imported.accounts && imported.transactions && imported.stocks) {
                db = imported;
                saveAll();
                renderAll();
                alert("Backup restored successfully!");
            } else {
                alert("Invalid backup file format.");
            }
        } catch (err) {
            alert("Error parsing JSON file: " + err);
        }
    };
    reader.readAsText(file);
    event.target.value = null; // reset input
};

window.factoryReset = function() {
    if(confirm("DANGER: This will permanently erase all data. Only do this if you have downloaded a backup. Proceed?")) {
        localStorage.removeItem('app_tx_v2');
        localStorage.removeItem('app_accounts');
        localStorage.removeItem('app_stocks');
        location.reload();
    }
}

// CSV MASS IMPORT ENGINE
window.downloadCsvTemplate = function() {
    const csvContent = "Date,AccountName,Category,Amount,Description\n" +
                       "2026-05-01,Sample Credit Card 1,Groceries,-150.25,Whole Foods\n" +
                       "2026-05-02,Sample Checking,Income,5000.00,Salary\n" +
                       "2026-05-03,Sample Credit Card 2,Entertainment,-25.00,Movie Tickets";
                       
    const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "budget_template.csv");
    dlAnchorElem.click();
    dlAnchorElem.remove();
}

window.handleCsvImport = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        
        // Ensure CSV has data besides header
        if (lines.length < 2) {
            alert("CSV file is empty or missing data rows.");
            event.target.value = '';
            return;
        }

        let newRecords = [];
        let errorList = [];
        const baseTime = Date.now(); // Used to ensure unique IDs during rapid generation

        // Loop rows (skipping header)
        for (let i = 1; i < lines.length; i++) {
            // Regex to split by comma, but ignore commas inside quotes
            const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());
            
            if(cols.length < 5) continue; // skip broken rows

            const dateRaw = cols[0];
            const accNameRaw = cols[1];
            const catRaw = cols[2];
            const amountRaw = parseFloat(cols[3]);
            const descRaw = cols[4];

            // 1. Validate Account
            const targetAcc = db.accounts.find(a => a.name.toLowerCase() === accNameRaw.toLowerCase());
            if (!targetAcc) {
                errorList.push(`Row ${i+1}: Could not find an account named "${accNameRaw}". Please create it in the Accounts tab first.`);
                continue;
            }

            // 2. Validate Numbers
            if (isNaN(amountRaw)) {
                errorList.push(`Row ${i+1}: Amount "${cols[3]}" is not a valid number.`);
                continue;
            }

            newRecords.push({
                id: 'T' + (baseTime + i), // Guarantee unique IDs based on row index
                date: dateRaw,
                accountId: targetAcc.id,
                category: catRaw || 'Other',
                amount: amountRaw,
                desc: descRaw,
                reconcile: false // Mass imports require manual review
            });
        }

        // Hard Block on Errors
        if (errorList.length > 0) {
            alert("IMPORT ABORTED due to the following errors:\n\n" + errorList.join('\n'));
            event.target.value = '';
            return;
        }

        // Execute Batch
        db.transactions = [...db.transactions, ...newRecords];
        saveAll();
        renderAll();
        alert(`Successfully imported ${newRecords.length} new transactions into your secure cloud!`);
        event.target.value = '';
    };
    reader.readAsText(file);
}

// REST OF CRUD DOM INTERFACES
let calActiveTx = null;
let calCurrentDate = new Date();

window.openCalendar = function(id) {
    const tx = db.transactions.find(t => t.id === id);
    if (!tx || !tx.recur || tx.recur === 'none') {
        alert("This transaction does not repeat.");
        return;
    }
    calActiveTx = tx;
    calCurrentDate = new Date(); // Start view at current month
    document.getElementById('cal-modal-title').innerText = tx.desc + " Projections";
    renderCalendarGrid();
    document.getElementById('calendar-modal').style.display = 'flex';
};

window.closeCalendar = function() {
    document.getElementById('calendar-modal').style.display = 'none';
    calActiveTx = null;
};

window.shiftCalMonth = function(offset) {
    calCurrentDate.setMonth(calCurrentDate.getMonth() + offset);
    renderCalendarGrid();
};

function renderCalendarGrid() {
    if (!calActiveTx) return;
    
    const projectedTxList = getProjectedTransactions();
    // Use startsWith to match the root ID and any _G (ghost) clones
    const activeDates = new Set(
        projectedTxList.filter(t => t.id.startsWith(calActiveTx.id)).map(t => t.date)
    );

    const year = calCurrentDate.getFullYear();
    const month = calCurrentDate.getMonth();
    
    document.getElementById('cal-month-label').innerText = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-day header">${d}</div>`).join('');
    
    for(let i=0; i<firstDay; i++) {
        grid.innerHTML += `<div></div>`;
    }
    for(let date=1; date<=daysInMonth; date++) {
        const mm = String(month+1).padStart(2,'0');
        const dd = String(date).padStart(2,'0');
        const dStr = `${year}-${mm}-${dd}`;
        
        const activeCls = activeDates.has(dStr) ? 'active' : '';
        grid.innerHTML += `<div class="cal-day ${activeCls}">${date}</div>`;
    }
}

document.getElementById('acc-type').addEventListener('change', (e) => {
    const wrapShow = e.target.value === 'Credit' ? 'flex' : 'none';
    document.getElementById('acc-limit-wrap').style.display = wrapShow;
    document.getElementById('acc-apr-wrap').style.display = wrapShow;
    document.getElementById('acc-stmt-wrap').style.display = wrapShow;
});

// CARD MOCKUP ENGINE
function bindCardMockupEngine() {
    const accSelect = document.getElementById('txn-account');
    if (accSelect) {
        accSelect.addEventListener('change', updateActiveCardMockup);
    }
}

function updateActiveCardMockup() {
    const accId = document.getElementById('txn-account').value;
    const mockup = document.getElementById('active-card-mockup');
    if (!mockup || !accId) return;

    const acc = db.accounts.find(a => a.id === accId);
    if (!acc) return;

    // Remove all existing theme classes
    mockup.className = "credit-card-mockup";

    if (acc.theme === 'theme-custom' && acc.customBg1) {
        // Apply fully custom inline style
        const angle = acc.customAngle || 135;
        mockup.style.background = `linear-gradient(${angle}deg, ${acc.customBg1}, ${acc.customBg2 || acc.customBg1})`;
        mockup.style.color = acc.customText || '#ffffff';
    } else {
        mockup.style.background = '';
        mockup.style.color = '';
        if (acc.theme) {
            mockup.classList.add(acc.theme);
        } else {
            mockup.classList.add(acc.type === 'Credit' ? 'theme-red' : 'theme-green');
        }
    }

    document.getElementById('cc-mock-name').innerText = acc.name;
    document.getElementById('cc-mock-type').innerText = acc.type === 'Credit' ? `Credit Limit: ${formatCurrency(acc.limit || 0)}` : 'Checking Account';
    // Show bank name on card if set
    const bankEl = mockup.querySelector('.cc-bank');
    if (bankEl) bankEl.innerText = acc.bank || 'Bank';
    
    lucide.createIcons();
}

// Ensure the local dev override binds the mockup after bypassing auth
if(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') {
    setTimeout(bindCardMockupEngine, 500); 
}
document.getElementById('account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('acc-type').value;
    const themeVal = document.getElementById('acc-theme').value;
    const newAcc = { 
        id: 'A' + Date.now(), 
        name: document.getElementById('acc-name').value,
        bank: document.getElementById('acc-bank').value || '',
        type: type,
        theme: themeVal
    };
    if (themeVal === 'theme-custom' && window._pendingCustomDesign) {
        newAcc.customBg1   = window._pendingCustomDesign.bg1;
        newAcc.customBg2   = window._pendingCustomDesign.bg2;
        newAcc.customText  = window._pendingCustomDesign.text;
        newAcc.customAngle = window._pendingCustomDesign.angle;
    }
    if (type === 'Credit') {
        newAcc.limit = parseFloat(document.getElementById('acc-limit').value);
        newAcc.apr = parseFloat(document.getElementById('acc-apr').value);
        const stmtDay = parseInt(document.getElementById('acc-stmt-day').value);
        if (!isNaN(stmtDay) && stmtDay >= 1 && stmtDay <= 31) {
            newAcc.statementDay = stmtDay;
        }
    }
    // Reset pending state and dropdown styling
    window._pendingCustomDesign = null;
    window._customDesignConfirmed = false;
    const themeSelEl = document.getElementById('acc-theme');
    themeSelEl.style.background = '';
    themeSelEl.style.color = '';
    db.accounts.push(newAcc);
    saveAll(); e.target.reset(); renderAll();
});
window.deleteAccount = function(id) {
    if(db.transactions.some(t => t.accountId === id) && !confirm("Account has transactions. Delete anyway?")) return;
    db.accounts = db.accounts.filter(a => a.id !== id);
    saveAll(); renderAll();
};
document.getElementById('stock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const symbol = document.getElementById('stk-symbol').value.toUpperCase();
    const idx = db.stocks.findIndex(s => s.symbol === symbol);
    const stockData = {
        id: idx > -1 ? db.stocks[idx].id : 'S' + Date.now(),
        symbol: symbol,
        desc: document.getElementById('stk-desc').value,
        qty: parseFloat(document.getElementById('stk-qty').value),
        price: idx > -1 ? (db.stocks[idx].price || 0) : 0, // Preserve live-fetched price; defaults to 0 until API refresh
        cost: parseFloat(document.getElementById('stk-cost').value)
    };
    if (idx > -1) db.stocks[idx] = stockData;
    else db.stocks.push(stockData);
    saveAll(); e.target.reset(); renderAll();
});
window.deleteStock = function(id) { db.stocks = db.stocks.filter(s => s.id !== id); saveAll(); renderAll(); };


window.openImportModal = function() {
    document.getElementById('import-modal').style.display = 'flex';
}

window.closeImportModal = function() {
    document.getElementById('import-modal').style.display = 'none';
}

window.openTxDetail = function(encStr) {
    const tx = JSON.parse(decodeURIComponent(encStr));
    const body = document.getElementById('tx-detail-body');
    body.innerHTML = `
        <h4 style="margin-bottom:0.5rem; font-size:1.2rem;">${tx.desc || 'Unnamed Transaction'}</h4>
        <div style="font-size:1.8rem; font-weight:bold; color: ${tx.amount >= 0 ? '#00c805' : '#ff5000'}; margin-bottom:1rem;">${formatCurrency(tx.amount)}</div>
        <p style="margin-bottom:0.3rem;"><strong style="color:var(--text-secondary);">Date:</strong> ${tx.date}</p>
        <p style="margin-bottom:0.3rem;"><strong style="color:var(--text-secondary);">Category:</strong> ${tx.category}</p>
        <p style="margin-bottom:0.3rem;"><strong style="color:var(--text-secondary);">Account:</strong> ${getAccountName(tx.accountId)}</p>
        ${tx.isGhost ? `<div style="background: rgba(88,166,255,0.1); border-left: 3px solid var(--accent); padding: 0.8rem; margin-top: 1rem; border-radius: 4px; font-size:0.85rem;"><i data-lucide="info" style="display:inline-block; vertical-align:middle; margin-right:4px;"></i> This is a projected occurrence. Editing it will open the original recurring core transaction.</div>` : ''}
    `;
    
    // Wire up Edit button
    const btn = document.getElementById('btn-route-edit');
    btn.onclick = () => {
        closeTxDetail();
        // Route to Transactions Tab 
        const tabBtn = document.querySelector('.tab-btn[data-target="tab-transactions"]');
        if (tabBtn) tabBtn.click();
        
        editTx(tx.id);
    };
    
    document.getElementById('tx-detail-modal').style.display = 'flex';
    lucide.createIcons();
}

window.closeTxDetail = function() {
    document.getElementById('tx-detail-modal').style.display = 'none';
}

/* ==================
   EXTERNAL INTEGRATIONS
   ================== */
window.saveApiKey = function() {
    const key = document.getElementById('finnhub-api-key').value;
    localStorage.setItem('finnhub_api_key', key);
    alert('API Key securely saved to Local Browser Storage!');
}

document.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem('finnhub_api_key');
    if(savedKey) {
        const el = document.getElementById('finnhub-api-key');
        if(el) el.value = savedKey;
    }
});

window.fetchLiveQuotes = async function() {
    const key = localStorage.getItem('finnhub_api_key');
    if(!key) {
        alert("Access Denied: Please provide a Finnhub API Key in the Settings tab.");
        return;
    }

    const btn = document.activeElement;
    const oldText = btn ? btn.innerHTML : '';
    if(btn) btn.innerHTML = 'Fetching Data...';

    let updatedCount = 0;
    try {
        for(let i=0; i<db.stocks.length; i++) {
            const sym = db.stocks[i].symbol;
            if(!sym) continue;
            
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`);
            if(!res.ok) throw new Error(`API HTTP Error: ${res.status}`);
            
            const data = await res.json();
            
            // Finnhub returns 'c' for Current Price. If it's valid, update it.
            if(data && data.c && data.c > 0) {
                db.stocks[i].price = data.c;
                updatedCount++;
            }
        }
        
        if(updatedCount > 0) {
            saveAll();
            renderAll(); // Rerender to instantly show changes
            alert(`Live market fetch strictly successful. Adjusted ${updatedCount} asset(s).`);
        } else {
            alert("No live pricing updates found for your current ticker symbols.");
        }
    } catch (err) {
        console.error("Live Fetch Error:", err);
        alert("Network Request Blocked. API Key invalid, or you bypassed rate limits.");
    } finally {
        if(btn) btn.innerHTML = oldText;
        lucide.createIcons();
    }
}


/* ==================
   INIT
   ================== */
// Rendering logic moved fully into auth.onAuthStateChanged() to block until payload arrives
// ─── CAPITAL SNAPSHOT DRILL-DOWN ────────────────────────────────────────────
window.openCapSnapshot = function(dateStr) {
    const modal = document.getElementById('cap-snapshot-modal');
    const body  = document.getElementById('cap-snap-body');
    
    // Split YYYY-MM-DD manually for cross-browser stability (avoiding 'Invalid Date')
    const parts = dateStr.split('-');
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0); 
    const dateDisplay = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('cap-snap-date').innerText = dateDisplay;

    // Pull all projected transactions up to and including this date
    const allTx = getProjectedTransactions();
    const cutoff = dateStr; // YYYY-MM-DD string comparison works lexicographically

    // Calculate running balance per account
    const balanceMap = {};  // accountId -> running total
    db.accounts.forEach(a => { balanceMap[a.id] = 0; });

    allTx
        .filter(tx => tx.date <= cutoff)
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach(tx => {
            const amt = parseFloat(tx.amount);
            if (balanceMap[tx.accountId] !== undefined) {
                balanceMap[tx.accountId] += amt;
            }
        });

    // Separate accounts into debit and credit
    const debitAccs  = db.accounts.filter(a => a.type === 'Debit');
    const creditAccs = db.accounts.filter(a => a.type === 'Credit');

    let totalDebit  = 0;
    let totalCredit = 0;

    function accRow(acc, balance) {
        const isCredit = acc.type === 'Credit';
        const displayBalance = isCredit ? Math.abs(balance) : balance;
        const colorClass = balance >= 0 ? '#00c805' : '#ff5000';
        const limitBar = isCredit && acc.limit
            ? `<div style="margin-top:0.4rem; background:#1e2329; border-radius:4px; height:4px; overflow:hidden;">
                   <div style="width:${Math.min(100, (Math.abs(balance)/acc.limit)*100).toFixed(1)}%; height:100%; background:${Math.abs(balance)/acc.limit > 0.8 ? '#ff5000' : '#58a6ff'}; border-radius:4px;"></div>
               </div>
               <div style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.2rem;">$${Math.abs(balance).toFixed(2)} / $${acc.limit.toLocaleString()} limit</div>`
            : '';
        return `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; padding:0.75rem; background:#0d1117; border:1px solid var(--card-border); border-radius:8px; margin-bottom:0.5rem;">
            <div>
                <div style="font-weight:600; font-size:0.95rem; color:#fff;">${acc.name}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.15rem;">${acc.type} Account</div>
                ${limitBar}
            </div>
            <div style="font-size:1.1rem; font-weight:700; color:${colorClass}; white-space:nowrap; margin-left:1rem;">${formatCurrency(displayBalance)}</div>
        </div>`;
    }

    let html = '';

    if (debitAccs.length) {
        html += `<div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); margin-bottom:0.5rem;">Checking / Savings</div>`;
        debitAccs.forEach(a => {
            const bal = balanceMap[a.id] || 0;
            totalDebit += bal;
            html += accRow(a, bal);
        });
    }

    if (creditAccs.length) {
        html += `<div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-secondary); margin: 0.75rem 0 0.5rem;">Credit Cards</div>`;
        creditAccs.forEach(a => {
            const bal = balanceMap[a.id] || 0;
            totalCredit += bal;
            html += accRow(a, bal);
        });
    }

    if (!html) {
        html = `<p style="color:var(--text-secondary); text-align:center;">No account data found.</p>`;
    }

    const workingCapital = totalDebit + totalCredit;
    const capColor = workingCapital >= 0 ? '#00c805' : '#ff5000';
    document.getElementById('cap-snap-total').innerText = formatCurrency(workingCapital);
    document.getElementById('cap-snap-total').style.color = capColor;
    body.innerHTML = html;
    modal.style.display = 'flex';
    lucide.createIcons();
};

// ─── CARD DESIGNER ───────────────────────────────────────────────────────────

// When user picks 'theme-custom' from dropdown, open the designer
window.onThemeSelectChange = function(val) {
    if (val === 'theme-custom') {
        // Pre-fill preview labels from the current form state
        const nameEl = document.getElementById('cd-preview-name');
        const bankEl = document.getElementById('cd-preview-bank');
        if (nameEl) nameEl.innerText = document.getElementById('acc-name').value || 'Card Name';
        if (bankEl) bankEl.innerText = document.getElementById('acc-bank').value || 'Bank Name';
        // Build preset swatches
        buildCardSwatches();
        updateCardPreview();
        document.getElementById('card-designer-modal').style.display = 'flex';
        lucide.createIcons();
    }
};

// Preset gradient swatches for the card designer
const CARD_PRESETS = [
    { name: 'Ocean Blue',    bg1: '#0b3558', bg2: '#041022', text: '#ffffff', angle: 135 },
    { name: 'Midnight',      bg1: '#0f0c29', bg2: '#302b63', text: '#ffffff', angle: 160 },
    { name: 'Emerald',       bg1: '#134e5e', bg2: '#71b280', text: '#ffffff', angle: 120 },
    { name: 'Sunset',        bg1: '#f7971e', bg2: '#ffd200', text: '#1a1a1a', angle: 135 },
    { name: 'Rose Gold',     bg1: '#b76e79', bg2: '#e8c5b0', text: '#2c1a1a', angle: 150 },
    { name: 'Obsidian',      bg1: '#1c1c1e', bg2: '#3a3a3c', text: '#f0f0f0', angle: 145 },
    { name: 'Electric Plum', bg1: '#4a0e8f', bg2: '#0052a3', text: '#ffffff', angle: 135 },
    { name: 'Arctic',        bg1: '#e0eafc', bg2: '#cfdef3', text: '#1a2a4a', angle: 180 },
    { name: 'Volcanic',      bg1: '#8b1a1a', bg2: '#240000', text: '#ffb3b3', angle: 135 },
    { name: 'Aurora',        bg1: '#00d2ff', bg2: '#3a7bd5', text: '#ffffff', angle: 120 },
];

function buildCardSwatches() {
    const container = document.getElementById('cd-swatches');
    if (!container) return;
    container.innerHTML = CARD_PRESETS.map((p, i) => `
        <div title="${p.name}" onclick="applyCardPreset(${i})" style="
            width: 40px; height: 26px; border-radius: 6px; cursor: pointer;
            background: linear-gradient(${p.angle}deg, ${p.bg1}, ${p.bg2});
            border: 2px solid transparent; transition: border-color 0.15s, transform 0.15s;
            flex-shrink: 0;
        " onmouseover="this.style.borderColor='#fff'; this.style.transform='scale(1.15)'"
           onmouseout="this.style.borderColor='transparent'; this.style.transform='scale(1)'">
        </div>`).join('');
}

window.applyCardPreset = function(idx) {
    const p = CARD_PRESETS[idx];
    document.getElementById('cd-bg1').value    = p.bg1;
    document.getElementById('cd-bg1-hex').value = p.bg1;
    document.getElementById('cd-bg2').value    = p.bg2;
    document.getElementById('cd-bg2-hex').value = p.bg2;
    document.getElementById('cd-text').value   = p.text;
    document.getElementById('cd-text-hex').value = p.text;
    document.getElementById('cd-angle').value  = p.angle;
    document.getElementById('cd-angle-val').innerText = p.angle + '°';
    updateCardPreview();
};

// Keep color pickers and hex inputs in sync
window.syncColorFromText = function(pickerId, hexId) {
    const hexVal = document.getElementById(hexId).value.trim();
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hexVal)) {
        document.getElementById(pickerId).value = hexVal;
    }
};

// Live-update the preview card inside the designer
window.updateCardPreview = function() {
    const bg1   = document.getElementById('cd-bg1').value;
    const bg2   = document.getElementById('cd-bg2').value;
    const text  = document.getElementById('cd-text').value;
    const angle = document.getElementById('cd-angle').value;

    // Sync hex inputs to match wheel
    document.getElementById('cd-bg1-hex').value = bg1;
    document.getElementById('cd-bg2-hex').value = bg2;
    document.getElementById('cd-text-hex').value = text;

    const preview = document.getElementById('card-designer-preview');
    preview.style.background = `linear-gradient(${angle}deg, ${bg1}, ${bg2})`;
    preview.style.color = text;
};

window.closeCardDesigner = function() {
    document.getElementById('card-designer-modal').style.display = 'none';
    // Reset dropdown if they cancelled without confirming
    const sel = document.getElementById('acc-theme');
    if (sel && sel.value === 'theme-custom' && !window._customDesignConfirmed) {
        sel.value = 'theme-green'; // revert to default
    }
    window._customDesignConfirmed = false;
};

// Stores the confirmed custom design on a temporary object read at form submit
window._pendingCustomDesign = null;
window._customDesignConfirmed = false;

window.confirmCardDesign = function() {
    window._pendingCustomDesign = {
        bg1:   document.getElementById('cd-bg1').value,
        bg2:   document.getElementById('cd-bg2').value,
        text:  document.getElementById('cd-text').value,
        angle: document.getElementById('cd-angle').value
    };
    window._customDesignConfirmed = true;
    document.getElementById('card-designer-modal').style.display = 'none';
    // Show a small preview swatch next to the dropdown
    const sel = document.getElementById('acc-theme');
    if (sel) sel.style.background = `linear-gradient(${window._pendingCustomDesign.angle}deg, ${window._pendingCustomDesign.bg1}, ${window._pendingCustomDesign.bg2})`;
    if (sel) sel.style.color = window._pendingCustomDesign.text;
};
