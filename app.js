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

    // За picsum/random URL-и, добавяме уникален параметър за всяко натискане
    let loadUrl = url;
    if (url.includes('picsum.photos') || url.includes('random')) {
        loadUrl = url + (url.includes('?') ? '&' : '?') + '_r=' + Date.now();
    }

    // --- Зареждаме картинката чрез <img> (заобикаля CORS!) ---
    const startTime = performance.now();

    const loadedImg = await new Promise((resolve, reject) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
            const img2 = new Image();
            img2.referrerPolicy = 'no-referrer';
            img2.onload = () => resolve(img2);
            img2.onerror = () => reject(new Error('Неуспешно зареждане. Провери дали URL-ът е директен линк към картинка.'));
            img2.src = loadUrl;
        };
        img.src = loadUrl;
    });

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    // --- Performance Resource Timing ---
    await new Promise(r => setTimeout(r, 100));
    const perfEntry = getPerformanceEntry(loadUrl) || getPerformanceEntry(url);

    // --- Размер: опитваме Performance API, после canvas estimate ---
    let sizeBytes = 0;
    let sizeEstimated = false;

    if (perfEntry) {
        sizeBytes = perfEntry.transferSize || perfEntry.encodedBodySize || perfEntry.decodedBodySize || 0;
    }

    // Ако Performance API не даде размер, оценяваме чрез canvas
    if (sizeBytes === 0) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = loadedImg.naturalWidth;
            canvas.height = loadedImg.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(loadedImg, 0, 0);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
            if (blob) {
                sizeBytes = blob.size;
                sizeEstimated = true;
            }
        } catch (e) {
            // Canvas tainted by CORS – използваме приблизителна оценка от пиксели
            const pixels = loadedImg.naturalWidth * loadedImg.naturalHeight;
            sizeBytes = Math.round(pixels * 0.5); // ~0.5 bytes/pixel за компресирано изображение
            sizeEstimated = true;
        }
    }

    const sizeKB = sizeBytes / 1024;
    const speedKBs = sizeKB > 0 ? sizeKB / (totalTime / 1000) : 0;

    // --- Проверяваме дали timing данните са CORS-ограничени ---
    let corsRestricted = true;
    if (perfEntry) {
        corsRestricted = perfEntry.corsRestricted;
    }

    // --- HTTP Headers чрез fetch (опционално) ---
    let headers = [];
    try {
        const resp = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer' });
        resp.headers.forEach((value, key) => {
            headers.push({ key, value });
        });
    } catch (e) {
        headers.push({ key: 'info', value: 'Headers недостъпни – CORS ограничение на сървъра' });
    }

    // Добавяме протокол
    if (perfEntry && perfEntry.protocol) {
        headers.push({ key: 'protocol (detected)', value: perfEntry.protocol });
    }
    // Добавяме размер
    if (sizeBytes > 0) {
        const hasContentLength = headers.some(h => h.key.toLowerCase() === 'content-length');
        if (!hasContentLength) {
            headers.push({
                key: 'content-length (detected)',
                value: sizeBytes + ' bytes' + (sizeEstimated ? ' (приблизително)' : '')
            });
        }
    }
    // Резолюция на изображението
    headers.push({
        key: 'resolution',
        value: loadedImg.naturalWidth + ' × ' + loadedImg.naturalHeight + ' px'
    });

    return {
        url: url,
        imageUrl: loadedImg.src,
        latencyMs: Math.round(totalTime),
        sizeBytes: sizeBytes,
        sizeKB: sizeKB > 0 ? sizeKB.toFixed(1) : 'N/A',
        sizeEstimated: sizeEstimated,
        speedKBs: speedKBs > 0 ? speedKBs.toFixed(1) : 'N/A',
        speedMBs: speedKBs > 0 ? (speedKBs / 1024).toFixed(2) : 'N/A',
        headers: headers,
        timing: perfEntry,
        corsRestricted: corsRestricted
    };
}

// ---- Performance Resource Timing ----

function getPerformanceEntry(url) {
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
        const name = entries[i].name;
        if (name === url || name.split('?')[0] === url.split('?')[0]) {
            const e = entries[i];
            // Ако requestStart е 0, браузърът скрива timing (CORS без Timing-Allow-Origin)
            const corsRestricted = e.requestStart === 0;
            return {
                dns: Math.round(e.domainLookupEnd - e.domainLookupStart),
                tcp: Math.round(e.connectEnd - e.connectStart),
                tls: Math.round(e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : 0),
                ttfb: corsRestricted ? 0 : Math.round(e.responseStart - e.requestStart),
                download: corsRestricted ? 0 : Math.round(e.responseEnd - e.responseStart),
                total: Math.round(e.responseEnd - e.startTime),
                protocol: e.nextHopProtocol || (url.startsWith('https') ? 'h2 (предполагаем)' : 'http/1.1 (предполагаем)'),
                transferSize: e.transferSize || 0,
                encodedBodySize: e.encodedBodySize || 0,
                decodedBodySize: e.decodedBodySize || 0,
                corsRestricted: corsRestricted
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

    // Timing breakdown – показваме само ако НЕ са CORS-ограничени
    let timingHTML = '';
    if (result.timing && !result.corsRestricted) {
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
        `;
    } else if (result.timing) {
        timingHTML = `
            <div class="stat-item">
                <span class="stat-label">DNS / TCP / TTFB</span>
                <span class="stat-value" style="color:var(--text-muted);font-size:0.75rem">скрити (CORS)</span>
            </div>
        `;
    }

    // Протокол винаги показваме
    if (result.timing) {
        timingHTML += `
            <div class="stat-item">
                <span class="stat-label">Протокол</span>
                <span class="stat-value size">${result.timing.protocol}</span>
            </div>
        `;
    }

    // Размер с маркер за приблизителен
    const sizeDisplay = result.sizeKB !== 'N/A'
        ? result.sizeKB + ' KB' + (result.sizeEstimated ? ' ≈' : '')
        : 'N/A';
    const speedDisplay = result.speedMBs !== 'N/A'
        ? result.speedMBs + ' MB/s' + (result.sizeEstimated ? ' ≈' : '')
        : 'N/A';

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
            <span class="result-url"><a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}</a></span>
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
                    <span class="stat-value size">${sizeDisplay}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Скорост</span>
                    <span class="stat-value speed">${speedDisplay}</span>
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
        const pct = Math.max((r.latencyMs / maxLatency) * 100, 3);
        let cls = 'fast';
        if (r.latencyMs > 500) cls = 'slow';
        else if (r.latencyMs > 200) cls = 'medium';

        // Ако барът е твърде тесен, показваме текста отвън
        const textInside = pct > 25;
        const barText = `${r.latencyMs}ms | ${r.sizeKB}KB`;

        return `
            <div class="compare-row">
                <span class="compare-label">#${r.number}</span>
                <div class="compare-bar-bg" title="${escapeHtml(r.url)}">
                    <div class="compare-bar-fill ${cls}" style="width: ${pct}%">
                        ${textInside ? barText : ''}
                    </div>
                    ${!textInside ? `<span class="compare-bar-text-outside">${barText}</span>` : ''}
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
