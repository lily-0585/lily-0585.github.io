// ===== 유틸 =====
const dateKey = (label)  => {
  const m = label.match(/^(\d{2})\.(\d{2})\(/);
  if (!m) return 0;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  return mm * 100 + dd;
};

const setLoading = (flag) => {
  const ovl = document.getElementById("overlay");
  if (!ovl) return;
  if (flag) ovl.classList.add("show");
  else ovl.classList.remove("show");
};

const formatDate = (dateStr) => {
  const match = dateStr.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일\s*([가-힣]+)?/);
  if (!match) return dateStr;
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const weekKor = match[4] ? match[4][0] : "";
  return `${month}.${day}${weekKor ? `(${weekKor})` : ""}`;
};

// ===== 뷰 토글 =====
const toggleViews = (mode /* 'table' | 'cards' */) => {
  const tableRegion = document.getElementById("tableRegion");
  const cardRegion  = document.getElementById("maxCardRegion");
  if (!tableRegion || !cardRegion) return;
  tableRegion.hidden = mode !== "table";
  cardRegion.hidden  = mode !== "cards";
};

// ===== 상태 =====
const viewState = { datasets: [], showingCondensed: false };
let readingLock = false;

// ===== 파싱 =====
const parseTxtContent = (content, initialCount = 0) => {
  const lines = content.split("\n");
  let currentDate = "";
  let dailyJoin = 0;
  let dailyLeave = 0;
  let cumulativeCount = initialCount;
  let prevCumulative = initialCount;
  const resultArr = [];

  const dateRegex  = /(\d{4})년 \d{1,2}월 \d{1,2}일\s*[가-힣]*/;
  const joinRegex  = /님이 들어왔습니다\./;
  const leaveRegex = /님이 나갔습니다\./;

  for (const line of lines) {
    const dateMatch = line.match(dateRegex);
    if (dateMatch) {
      if (currentDate) {
        cumulativeCount += dailyJoin - dailyLeave;
        resultArr.push({ date: currentDate, count: cumulativeCount, change: cumulativeCount - prevCumulative });
        prevCumulative = cumulativeCount;
      }
      currentDate = dateMatch[0];
      dailyJoin = 0;
      dailyLeave = 0;
    }
    if (joinRegex.test(line))  dailyJoin++;
    if (leaveRegex.test(line)) dailyLeave++;
  }

  if (currentDate) {
    cumulativeCount += dailyJoin - dailyLeave;
    resultArr.push({ date: currentDate, count: cumulativeCount, change: cumulativeCount - prevCumulative });
  }

  const rows = resultArr.map(r => ({ label: formatDate(r.date), count: r.count, change: r.change }));

  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), -Infinity);
  const latestMax = rows.filter(r => r.count === maxCount).sort((a, b) => dateKey(a.label) - dateKey(b.label)).at(-1) || null;

  return { rows, max: latestMax ? { label: latestMax.label, count: latestMax.count } : null };
};

const parseFile = (file, initialCount = 0) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows, max } = parseTxtContent(e.target.result, initialCount);
      resolve({ fileName: file.name, rows, max });
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });

// ===== 표 렌더(파일별 패널) =====
const renderAll = () => {
  const wrap = document.getElementById("fileTables");
  wrap.innerHTML = "";

  for (const ds of viewState.datasets) {
    const panel = document.createElement("div");
    panel.className = "file-panel";
    panel.setAttribute("role", "listitem");

    const title = document.createElement("div");
    title.className = "file-title";
    title.title = ds.fileName;
    title.textContent = ds.fileName;
    panel.appendChild(title);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr><th>날짜</th><th>누적 인원</th><th>변동</th></tr>`;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    ds.rows.forEach((r, i) => {
      let diffStr = "-";
      let diffClass = "change-same";
      if (i > 0 || (i === 0 && typeof r.change === "number" && r.change !== 0)) {
        if (r.change > 0) { diffStr = `▲ ${r.change}명`; diffClass = "change-up"; }
        else if (r.change < 0) { diffStr = `▼ ${Math.abs(r.change)}명`; diffClass = "change-down"; }
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.label}</td><td>${r.count}명</td><td class="${diffClass}">${diffStr}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    panel.appendChild(table);
    wrap.appendChild(panel);
  }

  toggleViews("table");
};

// ===== 승자 구조 생성: 날짜/파일 기준 동시 반환 =====
const buildWinners = () => {
  // date -> [{fileName,count}]  (각 파일의 해당 날짜 '최대치'를 모두 보관)
  const dateMap = new Map();
  // fileName -> [{label,count}] (파일별로 '날짜-최대치' 목록)
  const perFileMap = new Map();

  for (const ds of viewState.datasets) {
    // 1) 이 파일 내부에서 날짜별 최대치 산출
    const perDateMax = new Map();
    for (const r of ds.rows) {
      const prev = perDateMax.get(r.label);
      if (prev == null || r.count > prev) perDateMax.set(r.label, r.count);
    }

    // 2) 파일별 맵에 삽입
    const rows = [];
    for (const [label, count] of perDateMax.entries()) {
      rows.push({ label, count });
      // 날짜별(전 파일 합산용) 맵에도 삽입
      if (!dateMap.has(label)) dateMap.set(label, []);
      dateMap.get(label).push({ fileName: ds.fileName, count });
    }
    rows.sort((a, b) => dateKey(a.label) - dateKey(b.label));
    perFileMap.set(ds.fileName, rows);
  }

  // 여기서 winnersByDate는 '날짜별 각 파일의 최대치 리스트'를 의미
  const winnersByDate = dateMap;
  // winnersByFile은 '파일별로 날짜-최대치 리스트'
  const winnersByFile = perFileMap;

  return { winnersByDate, winnersByFile };
};

// ===== 최대치 보기: 요약 + 파일별 리스트 =====
const renderWinnersView = () => {
  const region = document.getElementById("maxCardRegion");
  const listWrap = document.getElementById("maxCards");
  listWrap.innerHTML = "";
  listWrap.className = "winner-file-list";

  let summarySlot = document.getElementById("winnerSummary");
  if (!summarySlot) {
    summarySlot = document.createElement("div");
    summarySlot.id = "winnerSummary";
    summarySlot.className = "winner-summary";
    region.insertBefore(summarySlot, listWrap);
  }

  const { winnersByDate, winnersByFile } = buildWinners();

  // 날짜별 합계 = '각 파일의 해당 날짜 최대치'의 합
  const summaryRows = Array.from(winnersByDate.entries())
    .map(([label, arr]) => ({ label, total: arr.reduce((s, x) => s + x.count, 0) }))
    .sort((a, b) => dateKey(a.label) - dateKey(b.label));

  const summaryTable = document.createElement("table");
  summaryTable.className = "winner-summary-table";
  summaryTable.innerHTML = `
    <thead><tr><th>날짜</th><th>합계(파일별 최대치 합)</th></tr></thead>
    <tbody>
      ${summaryRows.map(r => `<tr><td>${r.label}</td><td>${r.total}명</td></tr>`).join("")}
    </tbody>
  `;
  summarySlot.innerHTML = "";
  summarySlot.appendChild(summaryTable);

  // 파일별 리스트(각 파일의 '날짜별 최대치')
  for (const ds of viewState.datasets) {
    const rows = winnersByFile.get(ds.fileName) || [];
    const block = document.createElement("div");
    block.className = "winner-file-block";

    const title = document.createElement("div");
    title.className = "winner-file-title";
    title.textContent = ds.fileName;
    block.appendChild(title);

    const table = document.createElement("table");
    table.className = "winner-table";
    table.innerHTML = `<thead><tr><th>날짜</th><th>최대 인원</th></tr></thead>`;
    const tbody = document.createElement("tbody");

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="2" style="color:#7b8190;">해당 날짜 없음</td>`;
      tbody.appendChild(tr);
    } else {
      for (const r of rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${r.label}</td><td>${r.count}명</td>`;
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    block.appendChild(table);
    listWrap.appendChild(block);
  }

  toggleViews("cards");
};

// ===== 바인딩 =====
const fileInput    = document.getElementById("fileInput");
const openPicker   = document.getElementById("openPicker");
const filenameSpan = document.getElementById("filename");
const btnC         = document.getElementById("btnShowCondensed");
const btnA         = document.getElementById("btnShowAll");

if (openPicker && fileInput) {
  const openDialog = () => {
    if (typeof fileInput.showPicker === "function") fileInput.showPicker();
    else fileInput.click();
  };
  openPicker.addEventListener("click", openDialog);
  openPicker.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.code === "Space") { e.preventDefault(); openDialog(); }
  });
}

if (fileInput) {
  fileInput.addEventListener("change", async function() {
    if (readingLock) return; readingLock = true;

    const files = Array.from(this.files || []);
    if (filenameSpan) {
      filenameSpan.textContent = files.length ? files.map(f => f.name).join(", ") : "선택된 파일 없음";
    }
    if (!files.length) { readingLock = false; return; }

    setLoading(true);
    try {
      const results = await Promise.all(files.map(f => parseFile(f, 0)));
      viewState.datasets = results;
      viewState.showingCondensed = false;
      renderAll(); // 업로드 후 표
      const listWrap = document.getElementById("maxCards");
      if (listWrap) listWrap.innerHTML = "";
      const summarySlot = document.getElementById("winnerSummary");
      if (summarySlot) summarySlot.innerHTML = "";
    } finally {
      setLoading(false);
      this.value = "";
      readingLock = false;
    }
  });
}

if (btnC) btnC.addEventListener('click', () => { renderWinnersView(); viewState.showingCondensed = true; });
if (btnA) btnA.addEventListener('click', () => { renderAll();         viewState.showingCondensed = false; });