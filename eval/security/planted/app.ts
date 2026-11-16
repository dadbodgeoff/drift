import express from 'express'
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
const pool = new Pool()
const app = express()
const API_KEY = "planted-credential-0123456789abcdef"
app.get('/a-direct', async (req, res) => { res.json(await pool.query(`SELECT * FROM t WHERE id = '${req.query.id}'`)) })
app.get('/b-local', async (req, res) => { const q = `SELECT * FROM t WHERE id = '${req.query.id}'`; res.json(await pool.query(q)) })
app.get('/c-concat', async (req, res) => { const q = "SELECT * FROM t WHERE id = '" + req.query.id + "'"; res.json(await pool.query(q)) })
app.get('/d-safe-const', async (req, res) => { const T = 'users'; res.json(await pool.query(`SELECT * FROM ${T} WHERE id = $1`, [req.query.id])) })
app.get('/e-path', (req, res) => { res.send(fs.readFileSync(path.join('/data', String(req.query.f)))) })
app.get('/f-exec', (req, res) => { const cmd = 'ls ' + req.query.d; exec(cmd, (e, o) => res.send(o)) })
app.post('/g-mass', async (req, res) => { res.json(await db.user.update({ where: { id: req.body.id }, data: req.body })) })
app.get('/h-proto', (req, res) => { const o: any = {}; o[req.query.k as string] = req.query.v; res.json(o) })
app.get('/i-regex', (req, res) => { res.json(new RegExp(String(req.query.r)).test('x')) })
app.get('/j-nosql', async (req, res) => { res.json(await coll.find({ $where: `this.u == ${req.query.u}` })) })
declare const db: any; declare const coll: any
app.listen(3000)
