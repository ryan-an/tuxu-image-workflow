import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { UniverSheetsDrawingPreset } from '@univerjs/preset-sheets-drawing';
import UniverSheetsDrawingZhCN from '@univerjs/preset-sheets-drawing/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-drawing/lib/index.css';
import './style.css';
import { readClipboardImages, loadClipboardImage } from '../integrations/paste-images.js';
import { loadSnapshot, saveSnapshot } from '../integrations/storage.js';

const STORAGE_KEY = 'image-workflow-univer-demo-v1';
const status = document.getElementById('save-status');
const errorBox = document.getElementById('error');
const roles = ['尺寸图','卖点图','细节图','场景 1','场景 2','场景 3','A+ 1','A+ 2','A+ 3','A+ 4'];
const products = Array.from({ length: 30 }, (_, index) => ({
  id: index === 0 ? '26-1732' : index === 1 ? '26-1683' : `26-${1800 + index}`,
  name: index % 2 === 0 ? '黑色缎面布料' : '透明植物托盘',
  facts: index % 2 === 0 ? '5 码装 / 黑色 / 缎面材质' : '10 个装 / 27 × 11 cm / 透明塑料',
}));
const styles = {
  header: { bg: { rgb: '#5B61D6' }, cl: { rgb: '#FFFFFF' }, bl: 1, fs: 11, ht: 2, vt: 2 },
  normal: { fs: 11, cl: { rgb: '#35415A' }, vt: 2 },
  stripe: { fs: 11, cl: { rgb: '#35415A' }, bg: { rgb: '#F4F5FB' }, vt: 2 },
  note: { fs: 11, cl: { rgb: '#6B7280' }, vt: 2 },
};
function makeRow(values, style = 'normal') {
  return Object.fromEntries(values.map((value, column) => [column, { v: value, s: style }]));
}
function makeSheet(id, name, cellData, extra = {}) {
  return { id, name, rowCount: 100, columnCount: 20, defaultColumnWidth: 125,
    defaultRowHeight: 36, cellData, rowData: { 0: { h: 38 } },
    freeze: { xSplit: 2, ySplit: 1, startRow: 1, startColumn: 2 }, ...extra };
}
function initialWorkbook() {
  const overview = { 0: makeRow(['产品编号','产品名称','产品资料',...roles,'进度','已选版本','备注'], 'header') };
  products.forEach((p, index) => {
    overview[index + 1] = makeRow([p.id,p.name,p.facts,...roles.map((role, i) =>
      index === 0 && i < 6 ? (i < 2 ? '已生成 · 3 版' : '已生成 · 2 版') : '待生成'),
    index === 0 ? '6 / 10' : '0 / 10',index === 0 ? '尺寸 V1、卖点 V1' : '',
    index < 2 ? '底部「参考图示例」查看图片' : '演示产品'], index % 2 ? 'stripe' : 'normal');
  });
  const references = {
    0: makeRow(['产品编号','产品名称 / 规格','实拍示意',...roles,'备注'], 'header'),
    1: makeRow([products[0].id,products[0].name+'\n'+products[0].facts,'',...roles.map(() => ''),'本地绘制的示例图片']),
    2: makeRow([products[1].id,products[1].name+'\n'+products[1].facts,'',...roles.map(() => ''),'本地绘制的示例图片']),
    4: makeRow(['使用方式','图片嵌入单元格；可调整行高、列宽，选中单元格复制图片。'],'note'),
    5: makeRow(['演示范围','支持石墨图片粘贴；暂未接入提示词生成、生图接口和历史版本管理。'],'note'),
  };
  return {
    id:'product-demo', name:'图序 · 30 套产品', appVersion:'1.0.4', locale:LocaleType.ZH_CN,
    sheetOrder:['overview','references'], styles,
    sheets:{
      overview:makeSheet('overview','产品总览',overview,{columnData:{0:{w:105},1:{w:155},2:{w:245},13:{w:95},14:{w:200},15:{w:230}}}),
      references:makeSheet('references','参考图示例',references,{defaultColumnWidth:160,columnData:{0:{w:105},1:{w:245},13:{w:215}},rowData:{0:{h:38},1:{h:124},2:{h:124},4:{h:42},5:{h:42}}}),
    },
  };
}

function sampleImage(productIndex, roleIndex) {
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 210;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = roleIndex % 2 ? '#E5EDD8' : '#F3ECDD'; ctx.fillRect(0,0,300,210);
  ctx.fillStyle = '#384536'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(roleIndex < 0 ? 'PRODUCT SAMPLE' : roles[roleIndex],150,25);
  if (productIndex === 0) {
    const gradient = ctx.createLinearGradient(25,45,270,145);
    [[0,'#0D1811'],[.16,'#607666'],[.28,'#152B1B'],[.52,'#7A9277'],[.64,'#0D2014'],[1,'#3F5C44']].forEach(([stop,color])=>gradient.addColorStop(stop,color));
    ctx.fillStyle=gradient; ctx.beginPath();ctx.moveTo(45,65);ctx.bezierCurveTo(105,36,200,55,257,70);ctx.lineTo(272,146);ctx.bezierCurveTo(160,127,113,182,34,155);ctx.closePath();ctx.fill();
  } else {
    ctx.save();ctx.translate(150,113);ctx.rotate(-.12);ctx.shadowColor='#54744555';ctx.shadowBlur=12;
    ctx.fillStyle='#FAFCF6';ctx.strokeStyle='#CCD8C4';ctx.lineWidth=4;ctx.beginPath();ctx.roundRect(-100,-35,200,70,20);ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;ctx.strokeStyle='#DFE8D8';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(-87,-24,174,48,13);ctx.stroke();ctx.restore();
  }
  ctx.fillStyle='#6F7868';ctx.font='11px sans-serif';ctx.fillText(productIndex===0?'5 YARDS · SATIN':'SET OF 10 · 27 × 11 cm',150,188);
  return canvas.toDataURL('image/png');
}

async function start() {
  const { univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: mergeLocales(UniverSheetsCoreZhCN,UniverSheetsDrawingZhCN) },
    presets: [UniverSheetsCorePreset({ container: 'sheet-container' }),UniverSheetsDrawingPreset()],
  });
  let stored = null;
  try { const parsed = await loadSnapshot(STORAGE_KEY) || JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); if(parsed?.sheets?.overview && parsed?.sheets?.references)stored=parsed; }
  catch { status.textContent='浏览器保存不可用，本次可导出数据'; }
  const workbook = univerAPI.createWorkbook(stored || initialWorkbook());
  window.demoAPI = univerAPI;
  // Native cell images need the sheet renderer and selection to be ready.
  if (univerAPI.getCurrentLifecycleStage() < univerAPI.Enum.LifecycleStages.Rendered) {
    await new Promise(resolve => {
      const subscription = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
        if (stage >= univerAPI.Enum.LifecycleStages.Rendered) { subscription.dispose(); resolve(); }
      });
    });
  }
  const sheet = workbook.getSheetBySheetId('references');
  workbook.setActiveSheet(sheet);
  const existingCells = workbook.save().sheets.references.cellData;
  const exampleSources = new Set();
  for(let p=0;p<2;p++) for(let i=-1;i<10;i++) {
    const source=sampleImage(p,i); exampleSources.add(source);
    const existing=existingCells?.[p+1]?.[i+3];
    // Preserve saved cell images and any user text in the reference cells.
    if (existing?.p?.drawings || existing?.v) continue;
    const range=sheet.getRange(p+1,i+3,1,1);
    range.activate();
    const bytes=Uint8Array.from(atob(source.split(',')[1]),char=>char.charCodeAt(0));
    const file=new File([bytes],`example-${p}-${i}.png`,{type:'image/png'});
    if (!await range.insertCellImageAsync(file)) throw new Error('无法插入单元格图片');
  }
  // Migrate only the demo's original floating pictures; keep unrelated drawings.
  const oldExamples=sheet.getImages().filter(image=>exampleSources.has(image.toBuilder().getSource()));
  if (oldExamples.length) sheet.deleteImages(oldExamples);
  sheet.getRange('B5').setValue('图片嵌入单元格；可调整行高、列宽，选中单元格复制图片。');
  sheet.getRange('B6').setValue('支持石墨图片粘贴；暂未接入提示词生成、生图接口和历史版本管理。');
  sheet.getRange('A1').activate();
  let importing = false;
  async function insertReferences(items, targetSheet, startRow, startColumn) {
    if (importing) return;
    importing = true;
    let succeeded = 0;
    const failed = [];
    try {
      for (const [index, item] of items.entries()) {
        status.textContent = `正在导入参考图 ${index + 1} / ${items.length}`;
        try {
          const file = item.file || await loadClipboardImage(item.url);
          const range = targetSheet.getRange(startRow + item.row, startColumn + item.column, 1, 1);
          workbook.setActiveSheet(targetSheet);
          range.activate();
          if (!await range.insertCellImageAsync(file)) throw new Error('单元格图片插入失败');
          targetSheet.setRowHeight(startRow + item.row, 124);
          succeeded++;
        } catch (error) { failed.push(`第 ${index + 1} 张：${error.message}`); }
      }
      status.textContent = `已导入 ${succeeded} 张参考图${failed.length ? `，${failed.length} 张失败` : ' · 点击保存保留修改'}`;
      errorBox.hidden = !failed.length;
      errorBox.textContent = failed.join('；');
      targetSheet.getRange(startRow, startColumn, 1, 1).activate();
    } finally { importing = false; }
  }
  document.addEventListener('paste', event => {
    if (dialog.open || (!document.getElementById('sheet-container').contains(event.target) && event.target !== document.body && event.target !== document.documentElement)) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const items = readClipboardImages(clipboard.getData('text/html'), clipboard.getData('text/plain'));
    if (!items.length) [...clipboard.files].filter(file => file.type.startsWith('image/')).forEach((file, column) => items.push({ row: 0, column, file }));
    if (!items.length) return;
    const target = workbook.getActiveSheet(), range = target.getActiveRange();
    if (!range) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void insertReferences(items, target, range.getRow(), range.getColumn());
  }, true);
  const dialog = document.getElementById('paste-dialog');
  let pasteTarget, pendingClipboardItems = [];
  const pasteContent = document.getElementById('paste-content');
  pasteContent.addEventListener('input', () => { pendingClipboardItems = []; });
  pasteContent.addEventListener('paste', event => {
    const clipboard = event.clipboardData;
    const items = readClipboardImages(clipboard.getData('text/html'), clipboard.getData('text/plain'));
    if (!items.length) [...clipboard.files].filter(file => file.type.startsWith('image/')).forEach((file, column) => items.push({ row: 0, column, file }));
    if (!items.length) return;
    event.preventDefault();
    pendingClipboardItems = items;
    pasteContent.value = clipboard.getData('text/plain') || `已识别 ${items.length} 张图片`;
    document.getElementById('paste-hint').textContent = `已识别 ${items.length} 张图片，点击插入。已有图片将被替换。`;
  });
  document.getElementById('paste-images').addEventListener('click', () => {
    const target = workbook.getActiveSheet(), range = target.getActiveRange();
    if (!range) return;
    pasteTarget = { target, row: range.getRow(), column: range.getColumn() };
    pendingClipboardItems = []; pasteContent.value = '';
    document.getElementById('paste-hint').textContent = '粘贴石墨复制内容或图片链接表格，图片从当前单元格依次填入。已有图片将被替换。';
    dialog.showModal(); document.getElementById('paste-content').focus();
  });
  document.getElementById('paste-cancel').onclick = () => dialog.close();
  document.getElementById('paste-insert').onclick = () => {
    const items = pendingClipboardItems.length ? pendingClipboardItems : readClipboardImages('', pasteContent.value);
    if (!items.length) { document.getElementById('paste-hint').textContent = '没有识别到图片链接，请粘贴石墨复制内容或图片链接表格。'; return; }
    dialog.close();
    void insertReferences(items, pasteTarget.target, pasteTarget.row, pasteTarget.column);
  };
  window.demoImport = { readClipboardImages, insertReferences };
  document.getElementById('save').disabled=false;
  document.getElementById('export').disabled=false;
  status.textContent=stored?'已恢复本机浏览器保存':'示例已就绪 · 点击保存保留修改';
  document.getElementById('save').addEventListener('click',async()=>{
    const button = document.getElementById('save'); button.disabled = true;
    try {await saveSnapshot(STORAGE_KEY,workbook.save());status.textContent='已保存到本机浏览器 · '+new Date().toLocaleTimeString('zh-CN');}
    catch { status.textContent='本机存储不足或不可用，请导出数据'; }
    finally { button.disabled = false; }
  });
  document.getElementById('export').addEventListener('click',async()=>{
    const button = document.getElementById('export'); button.disabled = true;
    status.textContent = '正在导出 Excel，包含单元格图片…';
    try {
      const { exportExcel } = await import('../integrations/export-excel.js');
      const { buffer, imageCount } = await exportExcel(workbook.save());
      const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download='图序-产品与参考图.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent=`Excel 已导出 · 包含 ${imageCount} 张图片`;
    } catch (error) {
      status.textContent = 'Excel 导出失败'; errorBox.hidden = false; errorBox.textContent = error.message;
    } finally { button.disabled = false; }
  });
}
start().catch(error=>{console.error(error);status.textContent='加载失败';errorBox.hidden=false;errorBox.textContent='表格加载失败：'+error.message;});
