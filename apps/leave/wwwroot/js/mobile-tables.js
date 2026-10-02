function setMobileTableLabels(){
  document.querySelectorAll('table.data-table, table.responsive-table').forEach(function(table){
    var heads = Array.from(table.querySelectorAll('thead th')).map(function(th){ return th.textContent.trim(); });
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach(function(row){
      if (row.classList.contains('audit-detail-row')) return;
      Array.from(row.children).forEach(function(cell, index){
        if (cell.tagName !== 'TD') return;
        cell.dataset.label = cell.colSpan > 1 ? '' : (heads[index] || '');
      });
    });
  });
}

function isLeaveIndexPage(){
  var path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  return path === '/leave' || path === '/leave/index';
}

function syncLeavePageForms(){
  if (!isLeaveIndexPage()) return;
  var params = new URLSearchParams(window.location.search);
  var fieldNames = ['Year', 'Month', 'CalendarView', 'SelfOnly', 'ShowOthers', 'ViewEmployeeId', 'RequestLimit'];
  document.querySelectorAll('.view-as-form, #leaveRequestListForm, #leaveRequestPageJumpForm').forEach(function(form){
    fieldNames.forEach(function(name){
      if (!params.has(name)) return;
      var field = form.querySelector('[name="' + name + '"]');
      if (field && field.type === 'hidden') field.value = params.get(name) || '';
    });
  });
}

function ensureAdminSpecialLeaveOption(){
  if (!isLeaveIndexPage()) return;
  var select = document.getElementById('ForceInput_Portion');
  if (!select || select.querySelector('option[value="특수휴가"]')) return;

  var option = document.createElement('option');
  option.value = '특수휴가';
  option.textContent = '특수 휴가 (연차 미차감)';
  select.appendChild(option);
}

function enhanceSharedUi(){
  setMobileTableLabels();
  syncLeavePageForms();
  ensureAdminSpecialLeaveOption();
}

function scheduleSharedUi(){
  window.setTimeout(enhanceSharedUi, 0);
  window.setTimeout(enhanceSharedUi, 300);
}

document.addEventListener('DOMContentLoaded', enhanceSharedUi);
window.addEventListener('pageshow', enhanceSharedUi);
document.addEventListener('click', scheduleSharedUi, true);
document.addEventListener('change', scheduleSharedUi, true);
document.addEventListener('submit', scheduleSharedUi, true);

if (document.body) {
  new MutationObserver(scheduleSharedUi).observe(document.body, { childList: true, subtree: true });
}

window.setMobileTableLabels = setMobileTableLabels;
window.syncLeavePageForms = syncLeavePageForms;
window.ensureAdminSpecialLeaveOption = ensureAdminSpecialLeaveOption;