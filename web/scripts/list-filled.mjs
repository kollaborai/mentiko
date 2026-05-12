import * as m from '@aliimam/icons/dist/index.mjs';
const names = Object.keys(m).filter(k => k.endsWith('Filled') && !k.endsWith('Metadata') && !k.endsWith('Props')).sort();
console.log(names.length + ' filled icons');
console.log(names.join('\n'));
