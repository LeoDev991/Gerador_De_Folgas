const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB setup
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

function migrate() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      store TEXT CHECK(store IN ('Nescafé','Living Heineken','Forneria','Qualycon','Quioque Living')) NOT NULL,
      category TEXT CHECK(category IN ('Ar','Terra')) NOT NULL,
      shift TEXT CHECK(shift IN ('Manhã','Tarde','Noite')) NOT NULL,
      schedule_type TEXT CHECK(schedule_type IN ('5x2','6x1')) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedule_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      status TEXT CHECK(status IN ('FOLGA','TRABALHO')) NOT NULL,
      FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )`);
  });
}

migrate();

// If employees table exists without the new store option, migrate to widen constraint.
function migrateStoreConstraint() {
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='employees'", (err, row) => {
    if (err || !row || !row.sql) return;
    if (row.sql.includes('Quioque Living')) return; // already updated
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = OFF');
      db.run(`CREATE TABLE employees_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        store TEXT CHECK(store IN ('Nescafé','Living Heineken','Forneria','Qualycon','Quioque Living')) NOT NULL,
        category TEXT CHECK(category IN ('Ar','Terra')) NOT NULL,
        shift TEXT CHECK(shift IN ('Manhã','Tarde','Noite')) NOT NULL,
        schedule_type TEXT CHECK(schedule_type IN ('5x2','6x1')) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`INSERT INTO employees_new (id,name,store,category,shift,schedule_type,created_at)
              SELECT id,name,store,category,shift,schedule_type,created_at FROM employees`);
      db.run('DROP TABLE employees');
      db.run('ALTER TABLE employees_new RENAME TO employees');
      db.run('PRAGMA foreign_keys = ON');
      console.log('employees table migrated to include store Quioque Living');
    });
  });
}

migrateStoreConstraint();

// Helpers
function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function listWeekends(month, year) {
  const total = daysInMonth(month, year);
  const weekends = [];
  for (let d = 1; d <= total; d++) {
    const date = new Date(year, month - 1, d);
    const dow = date.getDay();
    if (dow === 6 && d + 1 <= total) {
      weekends.push({ sat: d, sun: d + 1 });
    }
  }
  return weekends;
}

function generate5x2Schedule(totalDays, month, year) {
  const weekendPairs = listWeekends(month, year);
  const chosenWeekend = weekendPairs.length ? randomChoice(weekendPairs) : null;
  const off = new Set();
  if (chosenWeekend) {
    off.add(chosenWeekend.sat);
    off.add(chosenWeekend.sun);
  }
  // start offset 0-4 keeps pattern varied
  const startOffset = Math.floor(Math.random() * 5);
  for (let day = 1 + startOffset, cycle = 0; day <= totalDays; day++, cycle++) {
    const patternPos = cycle % 7; // 0-6 pattern 5 work, 2 off
    const isOff = patternPos >= 5;
    if (isOff) off.add(day);
  }
  // ensure at least one pair of consecutive days
  // we already have pattern; but guarantee total days off distribution reasonable
  return off;
}

function hasMoreThanTwoConsecutive(offSet, totalDays) {
  if (offSet.size === 0) return false;
  const arr = Array.from(offSet).sort((a, b) => a - b);
  let streak = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === arr[i - 1] + 1) {
      streak += 1;
      if (streak > 2) return true;
    } else {
      streak = 1;
    }
  }
  return false;
}

function trimToMaxTwoConsecutive(offSet) {
  const arr = Array.from(offSet).sort((a, b) => a - b);
  let streak = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === arr[i - 1] + 1) {
      streak += 1;
      if (streak > 2) {
        // remove current day to break chain
        offSet.delete(arr[i]);
      }
    } else {
      streak = 1;
    }
  }
}

function exceedsMaxWorkStreak(offSet, totalDays, maxWork) {
  let streak = 0;
  for (let day = 1; day <= totalDays; day++) {
    if (offSet.has(day)) {
      streak = 0;
    } else {
      streak += 1;
      if (streak > maxWork) return true;
    }
  }
  return false;
}

function enforceMaxWorkStreak(offSet, totalDays, maxWork, keyPrefix, existingOffMap) {
  let streak = 0;
  for (let day = 1; day <= totalDays; day++) {
    if (offSet.has(day)) {
      streak = 0;
      continue;
    }
    streak += 1;
    if (streak > maxWork) {
      // need to insert a folga on this day or next available
      let placed = false;
      for (let shift = 0; day + shift <= totalDays; shift++) {
        const targetDay = day + shift;
        const key = `${keyPrefix}-${targetDay}`;
        if (!offSet.has(targetDay) && !existingOffMap.has(key)) {
          offSet.add(targetDay);
          existingOffMap.add(key);
          placed = true;
          streak = 0;
          break;
        }
      }
      if (!placed) {
        // if cannot place without conflito, keep streak capped to avoid infinite loop
        streak = maxWork;
      }
    }
  }
}

function ensurePairsFor5x2(offSet, totalDays, keyPrefix, existingOffMap) {
  const hasNeighbor = (d) => offSet.has(d - 1) || offSet.has(d + 1);
  const tryAdd = (day) => {
    const key = `${keyPrefix}-${day}`;
    if (day >= 1 && day <= totalDays && !offSet.has(day) && !existingOffMap.has(key)) {
      // avoid creating streaks >2
      const left = offSet.has(day - 1);
      const right = offSet.has(day + 1);
      if (left && offSet.has(day - 2)) return false;
      if (right && offSet.has(day + 2)) return false;
      offSet.add(day);
      existingOffMap.add(key);
      return true;
    }
    return false;
  };

  const singles = Array.from(offSet).filter((d) => !hasNeighbor(d)).sort((a, b) => a - b);
  singles.forEach((d) => {
    // prefer right, then left
    if (tryAdd(d + 1)) return;
    if (tryAdd(d - 1)) return;
  });
}

function hasConflict(offSet, keyPrefix, existingOffMap) {
  for (const d of offSet) {
    if (existingOffMap.has(`${keyPrefix}-${d}`)) return true;
  }
  return false;
}

function validateConstraints(offSet, totalDays, maxWork) {
  if (hasMoreThanTwoConsecutive(offSet, totalDays)) return false;
  if (exceedsMaxWorkStreak(offSet, totalDays, maxWork)) return false;
  return true;
}

function meetsMinimumOff(offSet, scheduleType, totalDays) {
  const ratio = scheduleType === '5x2' ? (2 / 7) : (1 / 7);
  const minOff = Math.ceil(totalDays * ratio);
  return offSet.size >= minOff;
}

function shiftConflicts(offSet, totalDays, keyPrefix, existingOffMap, maxWork) {
  // try to move conflicting days to nearest free day while keeping rules
  const conflicts = [];
  for (const d of offSet) {
    if (existingOffMap.has(`${keyPrefix}-${d}`)) conflicts.push(d);
  }
  conflicts.sort((a, b) => a - b);
  conflicts.forEach((d) => offSet.delete(d));

  const tryPlace = (day) => {
    if (day < 1 || day > totalDays) return false;
    const key = `${keyPrefix}-${day}`;
    if (existingOffMap.has(key)) return false;
    offSet.add(day);
    if (!validateConstraints(offSet, totalDays, maxWork)) {
      offSet.delete(day);
      return false;
    }
    return true;
  };

  for (const d of conflicts) {
    let placed = false;
    for (let delta = 1; delta <= totalDays && !placed; delta++) {
      if (tryPlace(d + delta)) { placed = true; break; }
      if (tryPlace(d - delta)) { placed = true; break; }
    }
    if (!placed) {
      // if cannot place anywhere, abort
      return false;
    }
  }
  return true;
}

function generate6x1Schedule(totalDays, month, year) {
  const sundays = [];
  for (let d = 1; d <= totalDays; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 0) sundays.push(d);
  }
  const chosenSunday = sundays.length ? randomChoice(sundays) : null;
  const off = new Set();
  if (chosenSunday) off.add(chosenSunday);
  const startOffset = Math.floor(Math.random() * 6);
  for (let day = 1 + startOffset, cycle = 0; day <= totalDays; day++, cycle++) {
    const patternPos = cycle % 7; // 6 work, 1 off
    const isOff = patternPos === 6;
    if (isOff) off.add(day);
  }
  return off;
}

function buildEmployeeOffDays(emp, month, year, existingOffMap, maxAttempts = 40) {
  const totalDays = daysInMonth(month, year);
  const keyPrefix = `${emp.store}-${emp.category}-${emp.shift}`;
  const maxWork = emp.schedule_type === '6x1' ? 6 : 5;

  for (let attempt = 0; attempt < maxAttempts * 3; attempt++) {
    const off = emp.schedule_type === '5x2'
      ? generate5x2Schedule(totalDays, month, year)
      : generate6x1Schedule(totalDays, month, year);

    trimToMaxTwoConsecutive(off);
    if (emp.schedule_type === '5x2') {
      ensurePairsFor5x2(off, totalDays, keyPrefix, existingOffMap);
    }
    enforceMaxWorkStreak(off, totalDays, maxWork, keyPrefix, existingOffMap);

    if (!validateConstraints(off, totalDays, maxWork)) continue;
    if (!meetsMinimumOff(off, emp.schedule_type, totalDays)) continue;
    if (hasConflict(off, keyPrefix, existingOffMap)) {
      // try to resolve by shifting
      if (!shiftConflicts(off, totalDays, keyPrefix, existingOffMap, maxWork)) continue;
      if (hasConflict(off, keyPrefix, existingOffMap)) continue;
      if (!validateConstraints(off, totalDays, maxWork)) continue;
      if (!meetsMinimumOff(off, emp.schedule_type, totalDays)) continue;
    }

    // commit
    for (const d of off) existingOffMap.add(`${keyPrefix}-${d}`);
    return off;
  }

  // deterministic greedy fallback to guarantee folgas
  const off = new Set();
  const markIfValid = (day) => {
    const key = `${keyPrefix}-${day}`;
    if (day < 1 || day > totalDays) return false;
    if (existingOffMap.has(key)) return false;
    off.add(day);
    if (!validateConstraints(off, totalDays, maxWork) || !meetsMinimumOff(off, emp.schedule_type, totalDays)) {
      off.delete(day);
      return false;
    }
    return true;
  };

  if (emp.schedule_type === '5x2') {
    const weekendPairs = listWeekends(month, year);
    if (weekendPairs.length) {
      const pair = weekendPairs[0];
      markIfValid(pair.sat);
      markIfValid(pair.sun);
    }
  } else {
    for (let d = 1; d <= totalDays; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 && markIfValid(d)) break;
    }
  }

  // fill remaining folgas from start of month respecting conflicts
  for (let d = 1; d <= totalDays; d++) {
    if (meetsMinimumOff(off, emp.schedule_type, totalDays)) break;
    markIfValid(d);
  }

  // still ensure conflicts avoided and constraints ok
  if (!meetsMinimumOff(off, emp.schedule_type, totalDays)) return new Set();
  if (!validateConstraints(off, totalDays, maxWork)) return new Set();
  for (const d of off) existingOffMap.add(`${keyPrefix}-${d}`);
  return off;
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// API
app.get('/api/employees', (_req, res) => {
  db.all('SELECT * FROM employees ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao listar funcionários' });
    res.json(rows);
  });
});

app.post('/api/employees', (req, res) => {
  const { name, store, category, shift, schedule_type } = req.body;
  if (!name || !store || !category || !shift || !schedule_type) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }
  db.get(
    'SELECT COUNT(*) as total FROM employees WHERE store = ? AND shift = ?',
    [store, shift],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Erro ao validar limite' });
      if (row && row.total >= 3) {
        return res.status(409).json({ error: 'Limite de 3 funcionários por loja e turno atingido' });
      }
      const stmt = db.prepare(`INSERT INTO employees (name, store, category, shift, schedule_type)
        VALUES (?,?,?,?,?)`);
      stmt.run(name.trim(), store, category, shift, schedule_type, function (err2) {
        if (err2) return res.status(500).json({ error: 'Erro ao salvar' });
        res.json({ id: this.lastID });
      });
    }
  );
});

app.delete('/api/employees/:id', (req, res) => {
  db.run('DELETE FROM employees WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'Erro ao remover' });
    if (this.changes === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ message: 'Removido' });
  });
});

app.post('/api/schedules/generate', (req, res) => {
  const { month, year } = req.body;
  const m = Number(month);
  const y = Number(year);
  if (!m || !y) return res.status(400).json({ error: 'Informe mês e ano' });

  db.all('SELECT * FROM employees', (err, employees) => {
    if (err) return res.status(500).json({ error: 'Erro ao carregar funcionários' });
    if (!employees.length) return res.status(400).json({ error: 'Cadastre funcionários antes de gerar' });

    const totalDays = daysInMonth(m, y);
    let scheduleRows = null;
    const maxGlobalAttempts = 200;

    for (let attempt = 0; attempt < maxGlobalAttempts; attempt++) {
      const existingOffMap = new Set();
      const rows = [];
      let failed = false;
      const ordered = shuffle(employees);

      for (const emp of ordered) {
        const offDays = buildEmployeeOffDays(emp, m, y, existingOffMap);
        if (offDays.size === 0) { failed = true; break; }
        for (let d = 1; d <= totalDays; d++) {
          rows.push({ employee_id: emp.id, day: d, status: offDays.has(d) ? 'FOLGA' : 'TRABALHO' });
        }
      }

      if (!failed) { scheduleRows = rows; break; }
    }

    // fallback muito relaxado: se ainda assim não gerou, crie sem considerar conflitos, priorizando folgas mínimas
    if (!scheduleRows) {
      const rows = [];
      employees.forEach((emp) => {
        const maxWork = emp.schedule_type === '6x1' ? 6 : 5;
        let off = emp.schedule_type === '5x2'
          ? generate5x2Schedule(totalDays, m, y)
          : generate6x1Schedule(totalDays, m, y);
        trimToMaxTwoConsecutive(off);
        enforceMaxWorkStreak(off, totalDays, maxWork, '', new Set());
        // se ainda não bater mínimo, completa de forma gulosa
        for (let d = 1; d <= totalDays && !meetsMinimumOff(off, emp.schedule_type, totalDays); d++) {
          off.add(d);
          trimToMaxTwoConsecutive(off);
        }
        for (let d = 1; d <= totalDays; d++) {
          rows.push({ employee_id: emp.id, day: d, status: off.has(d) ? 'FOLGA' : 'TRABALHO' });
        }
      });
      scheduleRows = rows;
    }

    db.serialize(() => {
      db.run('INSERT INTO schedules (month, year) VALUES (?,?)', [m, y], function (err2) {
        if (err2) return res.status(500).json({ error: 'Erro ao salvar escala' });
        const scheduleId = this.lastID;
        const stmt = db.prepare('INSERT INTO schedule_days (schedule_id, employee_id, day, status) VALUES (?,?,?,?)');
        for (const row of scheduleRows) stmt.run(scheduleId, row.employee_id, row.day, row.status);
        stmt.finalize();
        res.json({ schedule_id: scheduleId });
      });
    });
  });
});

function fetchSchedule(id, callback) {
  db.get('SELECT * FROM schedules WHERE id = ?', [id], (err, sched) => {
    if (err || !sched) return callback(err || new Error('not found'));
    db.all('SELECT * FROM schedule_days WHERE schedule_id = ?', [id], (err2, days) => {
      if (err2) return callback(err2);
      db.all('SELECT * FROM employees', (err3, employees) => {
        if (err3) return callback(err3);
        callback(null, { schedule: sched, days, employees });
      });
    });
  });
}

app.get('/api/schedules/latest', (_req, res) => {
  db.get('SELECT * FROM schedules ORDER BY created_at DESC LIMIT 1', (err, sched) => {
    if (err) return res.status(500).json({ error: 'Erro ao buscar' });
    if (!sched) return res.json({ schedule: null, days: [], employees: [] });
    fetchSchedule(sched.id, (err2, data) => {
      if (err2) return res.status(500).json({ error: 'Erro ao carregar escala' });
      res.json(data);
    });
  });
});

app.get('/api/schedules/:id/export', (req, res) => {
  const format = req.query.format || 'csv';
  fetchSchedule(req.params.id, (err, data) => {
    if (err) return res.status(404).json({ error: 'Escala não encontrada' });
    const { schedule, days, employees } = data;
    const totalDays = daysInMonth(schedule.month, schedule.year);
    const byEmp = new Map();
    days.forEach((d) => {
      if (!byEmp.has(d.employee_id)) byEmp.set(d.employee_id, Array(totalDays).fill('TRABALHO'));
      byEmp.get(d.employee_id)[d.day - 1] = d.status;
    });
    let csv = 'Funcionario,Loja,Categoria,Turno,';
    for (let d = 1; d <= totalDays; d++) csv += `${d < 10 ? '0' + d : d}/${schedule.month},`;
    csv = csv.replace(/,$/, '\n');
    employees.forEach((e) => {
      const row = byEmp.get(e.id) || Array(totalDays).fill('');
      const compact = row.map(v => v === 'FOLGA' ? 'F' : 'T');
      csv += `${e.name},${e.store},${e.category},${e.shift},${compact.join(',')}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=escala_${schedule.month}-${schedule.year}.csv`);
    res.send(csv);
  });
});

// SPA fallback (must be last)
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
