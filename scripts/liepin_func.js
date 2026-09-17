// 注入猎聘页面用的函数
window.__lpCards = () => {
  const cards = [...document.querySelectorAll('.job-card-pc-container')];
  return JSON.stringify(cards.map(c => {
    try {
      const a = c.querySelector('a[data-nick="job-detail-job-info"]');
      if (!a) return null;
      const nameEl = a.querySelector('div.ellipsis-1[title]');
      let jobName = nameEl ? (nameEl.getAttribute('title') || '') : '';
      jobName = jobName.replace(/^招聘/, '').trim();
      const cityEl = a.querySelector('span.ellipsis-1');
      // 薪资：在卡片所有 span 中挑真正符合薪资格式的，避免误取「急聘」「高薪」等徽标
      const SAL_RE = /^(\d+(\.\d+)?-\d+(\.\d+)?[kK万]|\d+[kK]|面议|薪资面议)(\s*[·•]\s*\d+薪)?$/;
      let salary = '';
      for (const s of a.querySelectorAll('span')) {
        const v = (s.innerText || '').trim();
        if (SAL_RE.test(v)) { salary = v; break; }
      }
      if (!salary) salary = (a.innerText || '').split('\n').map(s => s.trim())
        .find(s => SAL_RE.test(s)) || '';
      const metaSpans = [...a.querySelectorAll(':scope > div:nth-of-type(2) > span')].map(s => (s.innerText || '').trim());
      const com = c.querySelector('[data-nick="job-detail-company-info"]');
      let company = '', industry = '', stage = '', scale = '';
      if (com) {
        const cn = com.querySelector('span.ellipsis-1');
        company = cn ? cn.innerText.trim() : '';
        const ms = [...com.querySelectorAll('div.ellipsis-1 span')].map(s => (s.innerText || '').trim()).filter(Boolean);
        industry = ms[0] || ''; stage = ms[1] || ''; scale = ms[2] || '';
      }
      const href = a.getAttribute('href') || '';
      const jobId = (href.match(/\/job\/(\d+)\.shtml/) || [])[1] || '';
      const txt = c.innerText || '';
      const recruiter = (txt.match(/[^\n]{1,12}·(HR|人事|招聘|顾问|经理|总监|主管|创始人|CEO|CTO)/) || [''])[0].trim();
      return {
        jobId, jobName,
        city: cityEl ? cityEl.innerText.trim() : '',
        salary: salary,
        exp: metaSpans[0] || '', edu: metaSpans[1] || '',
        company, industry, stage, scale, recruiter,
        detailUrl: jobId ? 'https://www.liepin.com/job/' + jobId + '.shtml' : ''
      };
    } catch (e) { return null; }
  }).filter(Boolean));
};

window.__lpDetail = (url) => fetch(url, { credentials: 'include' }).then(r => r.text()).then(t => {
  const dec = s => s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const jdM = t.match(/<dd[^>]*data-selector="job-intro-content"[^>]*>([\s\S]*?)<\/dd>/);
  const ciM = t.match(/<section class="company-intro-container"[\s\S]*?<div class="inner[^"]*">([\s\S]*?)<\/div>/);
  const indM = t.match(/行业要求：([^<]{1,60})/);
  // 职位福利：<!-- 职位福利 --> <div class="labels"><span>五险一金</span>…</div>
  const wfM = t.match(/职位福利[\s\S]{0,120}?<div class="labels">([\s\S]*?)<\/div>/);
  const welfare = wfM ? [...wfM[1].matchAll(/<span[^>]*>([^<]{1,24})<\/span>/g)].map(x => x[1].trim()).filter(Boolean).join('、') : '';
  // 招聘人数 / 更新时间
  const cntM = t.match(/招\s*(\d+)\s*人/);
  const updM = t.match(/(\d{1,2}月\d{1,2}日)更新/);
  return JSON.stringify({
    jd: jdM ? dec(jdM[1]) : '',
    companyIntro: ciM ? dec(ciM[1]).slice(0, 500) : '',
    industryReq: indM ? indM[1].trim() : '',
    welfare: welfare,
    headcount: cntM ? cntM[1] : '',
    updated: updM ? updM[1] : ''
  });
});
'LP_FUNC_OK'
