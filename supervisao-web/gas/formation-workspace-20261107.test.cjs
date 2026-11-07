const fs=require('fs'),vm=require('vm'),assert=require('assert');
const c={console,logText_:v=>String(v||'').trim(),logNorm_:v=>String(v||'').trim().toUpperCase(),formDirectAllowed_:()=>true};vm.createContext(c);
vm.runInContext(fs.readFileSync('supervisao-web/gas/Formation.gs','utf8')+'\n'+fs.readFileSync('supervisao-web/gas/FormationWorkspace-20261107.gs','utf8'),c);
const event=(type,to,data,keys=[])=>[String(Math.random()),++rev,'2026-11-07T02:10:10.470Z','usuario',type,JSON.stringify(keys),'{}',to,JSON.stringify(data)];let rev=0;
const keys=Array.from({length:8},(_,i)=>'ord_2026_7954_'+i),rows=[event('CRIAR','m1',{name:'MONTAGEM 1'},keys)];
let st=c.formFleetHydrate_(c.formExpReplay_(rows));assert.equal(st.montages.m1.name,'MONTAGEM 1');assert.equal(Object.keys(st.assignments).length,8);
assert(c.formFleetValidPlate_('ABC1234'));assert(c.formFleetValidPlate_('SBD4F24'));assert(!c.formFleetValidPlate_('NVH1DO5'));assert.equal(c.formFleetPlate_('sbd-4f24'),'SBD4F24');
assert.throws(()=>c.formFleetValidateVehicle_({plate:'SBD4F24',type:'BAÚ',capacityKg:0}));
const v=c.formFleetValidateVehicle_({plate:'SBD4F24',type:'baú',capacityKg:1000,defaultDriver:'VALDINEZ'});
rows.push(event('VEICULO_SALVAR','',{vehicle:v}),event('CONFIGURAR_CARGA','m1',{vehicleId:v.plate,driver:'VALDINEZ'}),event('PESOS_PEDIDOS','m1',{weights:Object.fromEntries(keys.map(k=>[k,100]))},keys));
st=c.formFleetHydrate_(c.formExpReplay_(rows));c.formFleetOptions_=s=>({vehicles:Object.values(s.fleetVehicles),drivers:[]});
function view(unknown=false,over=false,sourceIssues=0){return c.formFleetEnhance_({orders:keys.map((key,i)=>({key,weight:over?200:100,weightIncomplete:unknown&&i===0,sourceRows:[{}]})),montages:[{...st.montages.m1,orderKeys:keys,orders:8,sourceIssues}]},unknown||over?{...st,orderWeights:{}}:st).montages[0]}
assert.equal(view().totalWeightKg,800);assert.equal(view().canFinalize,true);assert.equal(view(true).canFinalize,false);assert.equal(view(true).totalWeightKg,null);assert.equal(view(false,true).overCapacity,true);assert.equal(view(false,true).canFinalize,false);assert.equal(view(false,false,1).canFinalize,false);
rows.push(event('FINALIZAR','m1',{vehicleSnapshot:{...v,totalWeightKg:800}}));st=c.formFleetHydrate_(c.formExpReplay_(rows));assert.equal(st.montages.m1.status,'Finalizada');assert.throws(()=>c.formFleetAssertMove_(st,{operation:'REMOVER',keys:[keys[0]]}));assert.throws(()=>c.formFleetAssertMove_(st,{operation:'ADICIONAR',target:'m1'}));assert.throws(()=>c.formFleetAssertMove_(st,{operation:'RENOMEAR',target:'m1'}));assert.equal(view().canFinalize,false);
rows.push(event('REABRIR','m1',{}));st=c.formFleetHydrate_(c.formExpReplay_(rows));assert.equal(st.montages.m1.status,'Em montagem');assert.equal(Object.keys(st.assignments).length,8);assert.equal(view().canFinalize,true);
assert.throws(()=>c.formExpReplay_(rows.concat([rows[0]])));console.log('PASS: montagem preservada, placas, capacidade obrigatória, pesos desconhecidos, excesso, origem alterada, finalização protegida e reabertura.');
