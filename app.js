// ============================================
// Meme Latency Checker – app.js
// Измерва latency, размер, скорост и headers
// Протоколи: TCP, HTTP/2, DNS
// ============================================

const urlInput = document.getElementById('urlInput');
const testBtn = document.getElementById('testBtn');
const loader = document.getElementById('loader');
const errorContainer = document.getElementById('errorContainer');
const resultsContainer = document.getElementById('results');
const compareSection = document.getElementById('compareSection');
const compareBars = document.getElementById('compareBars');

// Масив за съхранение на всички тестове (за сравнение)
let testResults = [];
let testCount = 0;

// ---- Event Listeners ----

testBtn.addEventListener('click', () => runTest());

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runTest();
});

// Quick-test бутони
document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        urlInput.value = btn.dataset.url;
        runTest();
    });
});

// ---- Основна функция за тестване ----

async function runTest() {
    const url = urlInput.value.trim();

    if (!url) {
        showError('Моля, въведи URL на меме изображение!');
        return;
    }

    if (!isValidUrl(url)) {
        showError('Невалиден URL. Увери се, че започва с https:// или http://');
        return;
    }

    // UI състояние: зареждане
    errorContainer.innerHTML = '';
    loader.classList.add('active');
    testBtn.disabled = true;

    try {
        const result = await measureMeme(url);
        testCount++;
        result.number = testCount;

        testResults.push(result);
        renderResult(result);
        updateCompareChart();

    } catch (err) {
        showError('Грешка при зареждане: ' + err.message);
    } finally {
        loader.classList.remove('active');
        testBtn.disabled = false;
    }
}

// ---- Измерване на меме ----

async function measureMeme(url) {
    // Изчистваме performance entries
    performance.clearResourceTimings();

    // --- Зареждаме картинката чрез <img> (заобикаля CORS!) ---
    const startTime = performance.now();

    await new Promise((resolve, reject) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Неуспешно зареждане. Провери дали URL-ът е директен линк към картинка (.jpg, .png, .gif).'));
        img.src = url;
    });

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    // --- Performance Resource Timing (TCP, DNS и др.) ---
    await new Promise(r => setTimeout(r, 100));

    const perfEntry = getPerformanceEntry(url);

    // Размер от Performance API
    let sizeBytes = 0;
    if (perfEntry) {
        sizeBytes = perfEntry.decodedBodySize || perfEntry.transferSize || perfEntry.encodedBodySize || 0;
    }

    const sizeKB = sizeBytes / 1024;
    const speedKBs = sizeKB > 0 ? sizeKB / (totalTime / 1000) : 0;

    // --- HTTP Headers чрез fetch (опционално) ---
    let headers = [];
    try {
        const resp = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer' });
        resp.headers.forEach((value, key) => {
            headers.push({ key, value });
        });
    } catch (e) {
        // CORS блокира fetch – нормално за imgur и други
        headers.push({ key: 'info', value: 'Headers недостъпни – CORS ограничение на сървъра' });
    }

    // Добавяме протокол от Performance API
    if (perfEntry && perfEntry.protocol) {
        headers.push({ key: 'protocol (detected)', value: perfEntry.protocol });
    }
    if (sizeBytes > 0) {
        const hasContentLength = headers.some(h => h.key.toLowerCase() === 'content-length');
        if (!hasContentLength) {
            headers.push({ key: 'content-length (detected)', value: sizeBytes + ' bytes' });
        }
    }

    return {
        url: url,
        imageUrl: url,
        latencyMs: Math.round(totalTime),
        sizeBytes: sizeBytes,
        sizeKB: sizeKB > 0 ? sizeKB.toFixed(1) : 'N/A',
        speedKBs: speedKBs > 0 ? speedKBs.toFixed(1) : 'N/A',
        speedMBs: speedKBs > 0 ? (speedKBs / 1024).toFixed(2) : 'N/A',
        headers: headers,
        timing: perfEntry
    };
}

// ---- Performance Resource Timing ----

function getPerformanceEntry(url) {
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
        const name = entries[i].name;
        // Сравняваме без query параметри или точно съвпадение
        if (name === url || name.split('?')[0] === url.split('?')[0]) {
            const e = entries[i];
            return {
                dns: Math.round(e.domainLookupEnd - e.domainLookupStart),
                tcp: Math.round(e.connectEnd - e.connectStart),
                tls: Math.round(e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : 0),
                ttfb: Math.round(e.responseStart - e.requestStart),
                download: Math.round(e.responseEnd - e.responseStart),
                total: Math.round(e.responseEnd - e.startTime),
                protocol: e.nextHopProtocol || 'неизвестен',
                transferSize: e.transferSize || 0,
                encodedBodySize: e.encodedBodySize || 0,
                decodedBodySize: e.decodedBodySize || 0
            };
        }
    }
    return null;
}

// ---- Рендериране на резултат ----

function renderResult(result) {
    const card = document.createElement('div');
    card.className = 'result-card';

    const latencyPercent = Math.min((result.latencyMs / 2000) * 100, 100);

    // Timing breakdown
    let timingHTML = '';
    if (result.timing) {
        timingHTML = `
            <div class="stat-item">
                <span class="stat-label">DNS Lookup</span>
                <span class="stat-value latency">${result.timing.dns}ms</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">TCP Connect</span>
                <span class="stat-value latency">${result.timing.tcp}ms</span>
            </div>
            ${result.timing.tls > 0 ? `
            <div class="stat-item">
                <span class="stat-label">TLS Handshake</span>
                <span class="stat-value latency">${result.timing.tls}ms</span>
            </div>` : ''}
            <div class="stat-item">
                <span class="stat-label">TTFB</span>
                <span class="stat-value latency">${result.timing.ttfb}ms</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Download</span>
                <span class="stat-value latency">${result.timing.download}ms</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Протокол</span>
                <span class="stat-value size">${result.timing.protocol}</span>
            </div>
        `;
    }

    // Headers
    let headersHTML = result.headers.map(h =>
        `<div class="header-row">
            <span class="header-key">${escapeHtml(h.key)}</span>
            <span class="header-val">${escapeHtml(h.value)}</span>
        </div>`
    ).join('');

    card.innerHTML = `
        <div class="result-header">
            <div class="result-number">${result.number}</div>
            <span class="result-url">${escapeHtml(result.url)}</span>
        </div>
        <div class="result-body">
            <div class="meme-preview">
                <img src="${escapeHtml(result.imageUrl)}" alt="Meme #${result.number}"
                     referrerpolicy="no-referrer"
                     onerror="this.alt='⚠️ Грешка при зареждане'">
            </div>
            <div class="stats-panel">
                <div class="stat-item">
                    <span class="stat-label">Latency</span>
                    <span class="stat-value latency">${result.latencyMs}ms</span>
                </div>
                <div class="latency-bar-wrap">
                    <div class="latency-bar" style="width: ${latencyPercent}%"></div>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Размер</span>
                    <span class="stat-value size">${result.sizeKB} KB</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Скорост</span>
                    <span class="stat-value speed">${result.speedMBs} MB/s</span>
                </div>
                ${timingHTML}
            </div>
            <div class="headers-section">
                <h3 class="headers-title">HTTP Headers</h3>
                <div class="headers-grid">${headersHTML}</div>
            </div>
        </div>
    `;

    resultsContainer.insertBefore(card, resultsContainer.firstChild);
}

// ---- Сравнение на мемета ----

function updateCompareChart() {
    if (testResults.length < 2) {
        compareSection.style.display = 'none';
        return;
    }

    compareSection.style.display = 'block';

    const maxLatency = Math.max(...testResults.map(r => r.latencyMs));

    compareBars.innerHTML = testResults.map((r) => {
        const pct = Math.max((r.latencyMs / maxLatency) * 100, 8);
        let cls = 'fast';
        if (r.latencyMs > 500) cls = 'slow';
        else if (r.latencyMs > 200) cls = 'medium';

        return `
            <div class="compare-row">
                <span class="compare-label">#${r.number}</span>
                <div class="compare-bar-bg" title="${escapeHtml(r.url)}">
                    <div class="compare-bar-fill ${cls}" style="width: ${pct}%">
                        ${r.latencyMs}ms &nbsp;|&nbsp; ${r.sizeKB}KB
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ---- Помощни функции ----

function isValidUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showError(msg) {
    errorContainer.innerHTML = `<div class="error-msg">⚠️ ${escapeHtml(msg)}</div>`;
    setTimeout(() => {
        const errEl = errorContainer.querySelector('.error-msg');
        if (errEl) errEl.remove();
    }, 5000);
}
