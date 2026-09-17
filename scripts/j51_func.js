// 注入 51job 搜索页的卡片解析函数
window.__j51Cards = function () {
  const cards = Array.prototype.slice.call(document.querySelectorAll('.joblist-item'));
  return JSON.stringify(cards.map(function (c) {
    const sd = c.querySelector('[sensorsdata]');
    let s = {};
    try { s = JSON.parse(sd ? sd.getAttribute('sensorsdata') : '{}'); } catch (e) { }
    const gt = function (sel) {
      const e = c.querySelector(sel);
      return e ? ((e.getAttribute('title') || e.textContent || '').trim()) : '';
    };
    const areaEl = c.querySelector('.area');
    const bcs = Array.prototype.map.call(c.querySelectorAll('.bc .dc'), function (x) {
      return (x.getAttribute('title') || x.textContent || '').trim();
    }).filter(Boolean);
    const tags = Array.prototype.map.call(c.querySelectorAll('.joblist-item-tags .tag'), function (x) {
      return (x.getAttribute('title') || x.textContent || '').trim();
    }).filter(Boolean);
    return {
      jobId: String(s.jobId || ''),
      jobName: gt('.jname') || s.jobTitle || '',
      salary: gt('.sal') || s.jobSalary || '',
      city: areaEl ? areaEl.textContent.trim().split('\n')[0].trim() : '',
      exp: s.jobYear || '',
      edu: s.jobDegree || '',
      company: gt('.cname'),
      companyId: String(s.companyId || ''),
      industry: bcs[0] || '',
      property: bcs[1] || '',
      scale: bcs[2] || '',
      tags: tags,
      publish: s.jobTime || ''
    };
  }));
};

// 注入 51job 详情页(须在 jobs.51job.com 域执行)：fetch 职位页取 JD
window.__j51Detail = function (jobId) {
  return fetch('https://jobs.51job.com/all/' + jobId + '.html', { headers: { 'Accept': 'text/html' } })
    .then(function (r) {
      if (r.status !== 200) return '{"err":"HTTP' + r.status + '"}';
      return r.text();
    })
    .then(function (t) {
      const doc = new DOMParser().parseFromString(t, 'text/html');
      const jdEl = doc.querySelector('.bmsg.job_msg') || doc.querySelector('.job_msg') || doc.querySelector('.job-detail .bmsg');
      const corpEl = doc.querySelector('.tmsg.inbox') || doc.querySelector('.job-corp .tmsg');
      const wfEls = doc.querySelectorAll('.job-detail .jtag, .jtag, .job-detail .t1 span');
      const wf = Array.prototype.map.call(wfEls, function (x) { return (x.textContent || '').trim(); }).filter(Boolean);
      const clean = function (el) {
        if (!el) return '';
        let s = el.innerHTML || '';
        s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/li>/gi, '\n');
        s = s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return s.split('\n').map(function (x) { return x.replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean).join('\n');
      };
      return JSON.stringify({ jd: clean(jdEl), corp: clean(corpEl).slice(0, 800), welfare: wf });
    })
    .catch(function (e) { return JSON.stringify({ err: String(e.message || e).slice(0, 80) }); });
};
