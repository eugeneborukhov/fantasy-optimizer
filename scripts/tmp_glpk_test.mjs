import fs from 'node:fs'
import GLPK from 'glpk.js'

const glpk = await GLPK()

const lp = {
  name: 'test',
  objective: {
    direction: glpk.GLP_MAX,
    name: 'obj',
    vars: [
      { name: 'x', coef: 1 },
      { name: 'y', coef: 2 },
    ],
  },
  subjectTo: [
    {
      name: 'c1',
      vars: [
        { name: 'x', coef: 1 },
        { name: 'y', coef: 1 },
      ],
      bnds: { type: glpk.GLP_UP, lb: 0, ub: 1 },
    },
  ],
  bounds: [
    { name: 'x', type: glpk.GLP_DB, lb: 0, ub: 1 },
    { name: 'y', type: glpk.GLP_DB, lb: 0, ub: 1 },
  ],
  binaries: ['x', 'y'],
}

const res = glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF })

const out = {
  topLevelKeys: Object.keys(res),
  resultKeys: Object.keys(res.result || {}),
  status: res.result?.status,
  z: res.result?.z,
  vars: res.result?.vars,
}

fs.writeFileSync('./tmp_glpk_res.json', JSON.stringify(out, null, 2))
console.log('wrote tmp_glpk_res.json')
