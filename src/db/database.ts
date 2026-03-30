import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const DB_DIR  = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'scot_quiz.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDB(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      subject      TEXT    NOT NULL,
      topic        TEXT    NOT NULL DEFAULT '',
      question     TEXT    NOT NULL,
      options      TEXT    NOT NULL,
      answer_index INTEGER NOT NULL,
      explanation  TEXT    NOT NULL DEFAULT '',
      exam_source  TEXT    NOT NULL DEFAULT '',
      created_by   INTEGER REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS topics (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      name    TEXT NOT NULL,
      slug    TEXT NOT NULL,
      UNIQUE(subject, slug)
    );
    CREATE TABLE IF NOT EXISTS resources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      subject     TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_url    TEXT NOT NULL,
      file_type   TEXT NOT NULL DEFAULT 'pdf',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      subject     TEXT,
      time_limit  INTEGER NOT NULL DEFAULT 30,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS test_questions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id     INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(test_id, question_id)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id      INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT,
      status       TEXT    NOT NULL DEFAULT 'in_progress',
      score        INTEGER,
      total        INTEGER,
      pct          REAL,
      UNIQUE(test_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS attempt_answers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id   INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      question_id  INTEGER NOT NULL REFERENCES questions(id),
      chosen_index INTEGER,
      is_correct   INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_question ON attempt_answers(attempt_id, question_id);
    CREATE TABLE IF NOT EXISTS scores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject    TEXT    NOT NULL,
      topic      TEXT,
      correct    INTEGER NOT NULL DEFAULT 0,
      total      INTEGER NOT NULL DEFAULT 0,
      pct        REAL    NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe migrations
  try { db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE questions ADD COLUMN created_by INTEGER REFERENCES users(id)`); } catch {}
  try { db.exec(`ALTER TABLE resources ADD COLUMN topic TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE resources ADD COLUMN resource_type TEXT NOT NULL DEFAULT 'note'`); } catch {}
  try { db.exec(`ALTER TABLE attempts ADD COLUMN violations INTEGER NOT NULL DEFAULT 0`); } catch {}

  // Replace old Chemistry topics with the correct 8 JAMB topics
  const correctChemSlugs = [
    'separation-purification', 'kinetic-theory-gas-laws', 'air-water-solubility',
    'acids-bases-salts', 'electrolysis-energy', 'chemical-equilibria',
    'metals-compounds', 'organic-chemistry',
  ];
  // Remove old Chemistry topics not in the correct list
  db.prepare(
    `DELETE FROM topics WHERE subject = 'Chemistry' AND slug NOT IN (${correctChemSlugs.map(() => '?').join(',')})`
  ).run(...correctChemSlugs);
  // Insert the correct ones if missing
  const chemTopics = [
    { name:'Separation, Purification & Chemical Combination', slug:'separation-purification' },
    { name:'Kinetic Theory, Gas Laws & Atomic Structure',     slug:'kinetic-theory-gas-laws' },
    { name:'Air, Water, Solubility & Environmental Pollution',slug:'air-water-solubility' },
    { name:'Acids, Bases, Salts & Oxidation/Reduction',       slug:'acids-bases-salts' },
    { name:'Electrolysis, Energy Changes & Reaction Rates',   slug:'electrolysis-energy' },
    { name:'Chemical Equilibria & Non-Metals',                slug:'chemical-equilibria' },
    { name:'Metals & Their Compounds',                        slug:'metals-compounds' },
    { name:'Organic Chemistry & Industry',                    slug:'organic-chemistry' },
  ];
  const insertTopic = db.prepare(`INSERT OR IGNORE INTO topics (subject, name, slug) VALUES ('Chemistry', ?, ?)`);
  const insertTopics = db.transaction(() => { for (const t of chemTopics) insertTopic.run(t.name, t.slug); });
  insertTopics();

  // Seed if empty
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    console.log('📦 Seeding admin user and questions…');
    seedAdmin();
    seedQuestions();
    console.log('✅ Done. Admin: admin@scotfree.com / Admin2026!');
  } else {
    const qCount = (db.prepare('SELECT COUNT(*) as c FROM questions').get() as { c: number }).c;
    if (qCount === 0) seedQuestions();
  }
}

function seedAdmin() {
  const hash = bcrypt.hashSync('Admin2026!', 10);
  db.prepare(`INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)`)
    .run('SCOT Admin', 'admin@scotfree.com', hash);
}

function seedQuestions() {
  const insertQ = db.prepare(`
    INSERT INTO questions (subject, topic, question, options, answer_index, explanation, exam_source)
    VALUES (@subject, @topic, @question, @options, @answer_index, @explanation, @exam_source)
  `);
  const insertT = db.prepare(`INSERT OR IGNORE INTO topics (subject, name, slug) VALUES (@subject, @name, @slug)`);
  const batchQ  = db.transaction((qs: any[]) => { for (const q of qs) insertQ.run({ ...q, options: JSON.stringify(q.options) }); });
  const batchT  = db.transaction((ts: any[]) => { for (const t of ts) insertT.run(t); });

  batchT([
    { subject:'Physics',   name:'Atomic & Quantum Physics', slug:'atomic-quantum' },
    { subject:'Physics',   name:'Waves & Optics',           slug:'waves-optics' },
    { subject:'Physics',   name:'Electromagnetism',         slug:'electromagnetism' },
    { subject:'Physics',   name:'Mechanics',                slug:'mechanics' },
    { subject:'Chemistry', name:'Separation, Purification & Chemical Combination', slug:'separation-purification' },
    { subject:'Chemistry', name:'Kinetic Theory, Gas Laws & Atomic Structure',    slug:'kinetic-theory-gas-laws' },
    { subject:'Chemistry', name:'Air, Water, Solubility & Environmental Pollution', slug:'air-water-solubility' },
    { subject:'Chemistry', name:'Acids, Bases, Salts & Oxidation/Reduction',      slug:'acids-bases-salts' },
    { subject:'Chemistry', name:'Electrolysis, Energy Changes & Reaction Rates',  slug:'electrolysis-energy' },
    { subject:'Chemistry', name:'Chemical Equilibria & Non-Metals',               slug:'chemical-equilibria' },
    { subject:'Chemistry', name:'Metals & Their Compounds',                       slug:'metals-compounds' },
    { subject:'Chemistry', name:'Organic Chemistry & Industry',                   slug:'organic-chemistry' },
    { subject:'Biology',   name:'Cell Biology',        slug:'cell-biology' },
    { subject:'Biology',   name:'Genetics',            slug:'genetics' },
    { subject:'Biology',   name:'Human Systems',       slug:'human-systems' },
    { subject:'Biology',   name:'Ecology & Nutrition', slug:'ecology-nutrition' },
    { subject:'English',   name:'Figures of Speech',    slug:'figures-of-speech' },
    { subject:'English',   name:'Grammar & Structure',  slug:'grammar' },
    { subject:'English',   name:'Vocabulary & Spelling',slug:'vocabulary' },
  ]);

  batchQ([
    // Physics
    { subject:'Physics', topic:'atomic-quantum', question:'Which best describes the photoelectric effect?', options:['Refraction of light in a prism','Emission of electrons when light strikes a metal surface','Diffraction of electrons through a slit','Emission of photons during atomic transitions'], answer_index:1, explanation:"The photoelectric effect is the emission of electrons when light of sufficient frequency hits a metal surface. Einstein's explanation earned the 1921 Nobel Prize (E = hf).", exam_source:'JAMB 2019' },
    { subject:'Physics', topic:'atomic-quantum', question:"In Bohr's model, the energy of an electron in the nth orbit is:", options:['Eₙ = nE₀','Eₙ = E₀/n','Eₙ = E₀/n²','Eₙ = n²E₀'], answer_index:2, explanation:"Bohr's formula: Eₙ = −13.6/n² eV. Energy is inversely proportional to n².", exam_source:'WAEC 2021' },
    { subject:'Physics', topic:'atomic-quantum', question:'The de Broglie wavelength of a particle is:', options:['Directly proportional to momentum','Inversely proportional to momentum','Proportional to kinetic energy','Independent of velocity'], answer_index:1, explanation:'λ = h/p. Wavelength is inversely proportional to momentum. This confirmed wave-particle duality.', exam_source:'JAMB 2020' },
    { subject:'Physics', topic:'atomic-quantum', question:'X-rays from sudden deceleration of fast electrons are called:', options:['Compton X-rays','Characteristic X-rays','Bremsstrahlung radiation','Photoelectric X-rays'], answer_index:2, explanation:"Bremsstrahlung ('braking radiation') is produced when electrons decelerate rapidly on hitting a heavy metal target.", exam_source:'NECO 2022' },
    { subject:'Physics', topic:'atomic-quantum', question:"Planck's quantum theory states that energy is emitted in discrete units called:", options:['Electrons','Photons','Quanta','Neutrons'], answer_index:2, explanation:'Energy is emitted/absorbed in packets called quanta. Each quantum: E = hf, where h = 6.63×10⁻³⁴ J·s.', exam_source:'JAMB 2018' },
    { subject:'Physics', topic:'atomic-quantum', question:'The work function of a metal is the:', options:['Energy of an emitted electron','Minimum energy to remove an electron from the surface','Maximum kinetic energy of photoelectrons','Energy stored in the metal lattice'], answer_index:1, explanation:'The work function (φ) is the minimum energy required to eject an electron. If hf < φ, no electron is emitted.', exam_source:'WAEC 2020' },
    { subject:'Physics', topic:'atomic-quantum', question:'Thermionic emission is caused by:', options:['High light intensity','Strong magnetic fields','High temperature','High voltage only'], answer_index:2, explanation:'Thermionic emission: electrons gain enough thermal energy to escape the metal surface. Principle of cathode ray tubes.', exam_source:'JAMB 2021' },
    { subject:'Physics', topic:'waves-optics', question:'Which EM wave has the highest frequency?', options:['Radio waves','Visible light','Ultraviolet','Gamma rays'], answer_index:3, explanation:'Gamma rays have the highest frequency in the EM spectrum. Order: Radio < Microwave < IR < Visible < UV < X-ray < Gamma.', exam_source:'WAEC 2022' },
    { subject:'Physics', topic:'atomic-quantum', question:'The electron-volt (eV) is a unit of:', options:['Electric charge','Electric potential','Energy','Power'], answer_index:2, explanation:'1 eV = energy gained by one electron moving through 1 V potential difference = 1.6×10⁻¹⁹ J.', exam_source:'JAMB 2022' },
    { subject:'Physics', topic:'atomic-quantum', question:'The Franck-Hertz experiment proved that atomic energy absorption is:', options:['Continuous','Random','Discrete (quantised)','Proportional to temperature'], answer_index:2, explanation:'Franck-Hertz (1914) confirmed quantised energy levels by showing mercury atoms absorb only fixed amounts (4.9 eV).', exam_source:'NECO 2020' },
    // Chemistry
    { subject:'Chemistry', topic:'redox', question:'What is the oxidation number of sulphur in H₂SO₄?', options:['+2','+4','+6','-2'], answer_index:2, explanation:'H=+1(×2), O=-2(×4). So: 2+S-8=0 → S=+6.', exam_source:'JAMB 2020' },
    { subject:'Chemistry', topic:'ionic-theory', question:'An electrolyte is a substance that:', options:['Conducts in solid state only','Produces ions when dissolved or melted','Is always a strong acid','Contains only covalent bonds'], answer_index:1, explanation:'Electrolytes produce free ions allowing electrical conduction.', exam_source:'WAEC 2021' },
    { subject:'Chemistry', topic:'redox', question:'Oxidation number of oxygen in H₂O₂:', options:['-2','-1','0','+1'], answer_index:1, explanation:'In H₂O₂: 2+2x=0 → x=-1. Peroxides are the exception to the -2 rule.', exam_source:'JAMB 2021' },
    { subject:'Chemistry', topic:'ionic-theory', question:'Which is a polyatomic anion?', options:['Na⁺','Ca²⁺','SO₄²⁻','Cl⁻'], answer_index:2, explanation:'SO₄²⁻ (sulphate) contains multiple atoms and carries a negative charge.', exam_source:'NECO 2022' },
    { subject:'Chemistry', topic:'redox', question:'Oxidation number of nitrogen in NH₃:', options:['+3','-3','0','+5'], answer_index:1, explanation:'N+3(+1)=0 → N=-3. Most reduced form of nitrogen.', exam_source:'JAMB 2019' },
    { subject:'Chemistry', topic:'bonding', question:'The Octet rule states atoms seek how many valence electrons?', options:['2','6','8','10'], answer_index:2, explanation:'Octet rule: atoms are most stable with 8 valence electrons, like noble gases.', exam_source:'WAEC 2020' },
    { subject:'Chemistry', topic:'redox', question:'Oxidation is defined as:', options:['Gain of electrons','Loss of electrons','Gain of protons','Loss of protons'], answer_index:1, explanation:'OIL RIG: Oxidation Is Loss (of electrons), Reduction Is Gain.', exam_source:'JAMB 2022' },
    { subject:'Chemistry', topic:'acids-bases', question:'Acids produce what ions in aqueous solution?', options:['OH⁻','H⁺ (H₃O⁺)','Na⁺','O²⁻'], answer_index:1, explanation:'Acids release H⁺ (protons) which form H₃O⁺ with water, making pH < 7.', exam_source:'NECO 2021' },
    { subject:'Chemistry', topic:'redox', question:'Oxidation number of a free element is always:', options:['+1','-1','0','variable'], answer_index:2, explanation:'Rule 1: all uncombined elements have oxidation number = 0.', exam_source:'WAEC 2022' },
    { subject:'Chemistry', topic:'ionic-theory', question:'Which is a strong electrolyte?', options:['Glucose solution','Ethanol','Sodium chloride solution','Distilled water'], answer_index:2, explanation:'NaCl fully dissociates into Na⁺ and Cl⁻, giving many free ions.', exam_source:'JAMB 2018' },
    // Biology
    { subject:'Biology', topic:'cell-biology', question:"The 'powerhouse of the cell' is the:", options:['Ribosome','Nucleus','Mitochondria','Golgi apparatus'], answer_index:2, explanation:"Mitochondria produce ATP via oxidative phosphorylation — the cell's energy currency.", exam_source:'WAEC 2021' },
    { subject:'Biology', topic:'human-systems', question:'Universal blood donor group:', options:['AB','A','B','O'], answer_index:3, explanation:'O (negative) lacks A and B antigens so it is accepted by all blood types.', exam_source:'JAMB 2020' },
    { subject:'Biology', topic:'human-systems', question:'The functional unit of the kidney is the:', options:['Alveolus','Nephron','Villus','Loop of Henle'], answer_index:1, explanation:'Each kidney has ~1 million nephrons that filter blood and produce urine.', exam_source:'NECO 2020' },
    { subject:'Biology', topic:'cell-biology', question:'Osmosis is the movement of water molecules:', options:['From low to high solute concentration through any membrane','From high to low solute concentration through a semi-permeable membrane','Against a concentration gradient','Only in plant cells'], answer_index:1, explanation:'Water moves from lower solute concentration to higher through a semi-permeable membrane.', exam_source:'JAMB 2021' },
    { subject:'Biology', topic:'cell-biology', question:'Photosynthesis occurs in the:', options:['Mitochondria','Nucleus','Chloroplast','Ribosome'], answer_index:2, explanation:'Chloroplasts contain chlorophyll. Light reactions in thylakoids; dark reactions in stroma.', exam_source:'WAEC 2022' },
    { subject:'Biology', topic:'human-systems', question:'Which is NOT a liver function?', options:['Detoxification','Bile production','Producing urine','Glycogen storage'], answer_index:2, explanation:'Urine production is a kidney function. The liver detoxifies, produces bile, and stores glycogen.', exam_source:'JAMB 2019' },
    { subject:'Biology', topic:'cell-biology', question:'Phagocytosis is the process of:', options:['Pinocytosis','Exocytosis','Engulfing large particles','Diffusion'], answer_index:2, explanation:"Phagocytosis ('cell eating'): cells engulf bacteria by extending pseudopodia. Used by white blood cells.", exam_source:'NECO 2021' },
    { subject:'Biology', topic:'genetics', question:"An organism's observable traits are its:", options:['Genotype','Phenotype','Karyotype','Allele'], answer_index:1, explanation:'Phenotype = observable characteristics resulting from genotype + environment.', exam_source:'WAEC 2020' },
    { subject:'Biology', topic:'genetics', question:'Asexual reproduction produces:', options:['Genetically diverse offspring','Cross-fertilised offspring','Genetically identical offspring','Offspring via pollination'], answer_index:2, explanation:'Asexual reproduction involves one parent and produces clones (e.g. budding, binary fission).', exam_source:'JAMB 2022' },
    { subject:'Biology', topic:'human-systems', question:'Site of gas exchange in the lungs:', options:['Trachea','Bronchi','Alveoli','Pleural cavity'], answer_index:2, explanation:'Alveoli have thin walls and rich capillary supply. O₂ in, CO₂ out. ~300 million alveoli per lung.', exam_source:'NECO 2022' },
    // English
    { subject:'English', topic:'figures-of-speech', question:"Figure of speech in: 'The wind whispered through the trees.'", options:['Simile','Hyperbole','Personification','Alliteration'], answer_index:2, explanation:"Personification gives human qualities (whispered) to a non-human thing (wind).", exam_source:'WAEC 2021' },
    { subject:'English', topic:'grammar', question:'Which is in the passive voice?', options:['She wrote the letter.','The letter was written by her.','She is writing the letter.','She will write the letter.'], answer_index:1, explanation:"Passive voice: subject receives the action. 'The letter was written by her.'", exam_source:'JAMB 2020' },
    { subject:'English', topic:'vocabulary', question:"'Verbose' means:", options:['Silent','Wordy','Angry','Confused'], answer_index:1, explanation:"'Verbose' = using more words than necessary. Antonyms: concise, terse.", exam_source:'NECO 2021' },
    { subject:'English', topic:'grammar', question:"'Running is her favourite exercise.' — 'Running' is a:", options:['Verb','Adjective','Gerund','Infinitive'], answer_index:2, explanation:"A gerund is a verb ending in '-ing' functioning as a noun. Here 'Running' is the subject.", exam_source:'JAMB 2019' },
    { subject:'English', topic:'figures-of-speech', question:"Device in: 'It was the best of times, it was the worst of times':", options:['Oxymoron','Antithesis','Euphemism','Litotes'], answer_index:1, explanation:"Antithesis places contrasting ideas in parallel structure. Opening of Dickens' A Tale of Two Cities.", exam_source:'WAEC 2022' },
    { subject:'English', topic:'vocabulary', question:"Correct spelling:", options:['Accomodation','Accommodation','Acommodation','Acomodation'], answer_index:1, explanation:"'Accommodation' — double C, double M. Mnemonic: CCoMModation.", exam_source:'NECO 2020' },
    { subject:'English', topic:'grammar', question:'Correct sentence with neither…nor:', options:['Neither the boys nor the girl are ready.','Neither the boys nor the girl is ready.','Neither the boys nor the girl were ready.','Neither the boys nor the girl have been ready.'], answer_index:1, explanation:"With 'neither…nor', the verb agrees with the nearest subject ('girl' = singular → 'is').", exam_source:'JAMB 2021' },
    { subject:'English', topic:'grammar', question:'A word that modifies a verb, adjective, or adverb is a:', options:['Pronoun','Adjective','Preposition','Adverb'], answer_index:3, explanation:"Adverbs modify verbs (ran quickly), adjectives (very tall), or other adverbs (quite slowly).", exam_source:'WAEC 2020' },
    { subject:'English', topic:'figures-of-speech', question:"Which is a metaphor?", options:["She is like a lion in battle.",'Time is a thief.',"He ran as fast as the wind.",'The stars twinkled in the sky.'], answer_index:1, explanation:"Metaphor = direct comparison without 'like/as'. 'Time is a thief.'", exam_source:'JAMB 2022' },
    { subject:'English', topic:'vocabulary', question:"Plural of 'phenomenon':", options:['Phenomenons','Phenomenas','Phenomena','Phenomenes'], answer_index:2, explanation:"Greek-origin word: phenomenon → phenomena. Similarly: criterion→criteria, datum→data.", exam_source:'NECO 2022' },
  ]);

  // Resources
  const insertR = db.prepare(`INSERT OR IGNORE INTO resources (subject, topic, title, description, file_url, file_type, resource_type) VALUES (@subject, @topic, @title, @description, @file_url, @file_type, @resource_type)`);
  const batchR  = db.transaction((rs: any[]) => { for (const r of rs) insertR.run(r); });
  batchR([
    { subject:'Physics',   topic:'atomic-quantum',  title:'Atomic & Quantum Physics SCOT Note',         description:'Complete notes on atomic structure, photoelectric effect, Bohr model.',   file_url:'/uploads/physics_atomic_note.pdf',      file_type:'pdf', resource_type:'note' },
    { subject:'Physics',   topic:'atomic-quantum',  title:'Atomic & Quantum Physics Past Questions',    description:'JAMB & WAEC past questions on atomic physics.',                           file_url:'/uploads/physics_atomic_pq.pdf',        file_type:'pdf', resource_type:'pq' },
    { subject:'Physics',   topic:'mechanics',       title:'Mechanics SCOT Note',                        description:'Newton\'s laws, motion, energy, momentum.',                              file_url:'/uploads/physics_mechanics_note.pdf',   file_type:'pdf', resource_type:'note' },
    { subject:'Physics',   topic:'mechanics',       title:'Mechanics Past Questions',                   description:'JAMB & WAEC past questions on mechanics.',                               file_url:'/uploads/physics_mechanics_pq.pdf',     file_type:'pdf', resource_type:'pq' },
    { subject:'Chemistry', topic:'redox',           title:'Redox Reactions SCOT Note',                  description:'Oxidation states, balancing redox equations, electrochemistry.',         file_url:'/uploads/chemistry_redox_note.pdf',     file_type:'pdf', resource_type:'note' },
    { subject:'Chemistry', topic:'redox',           title:'Redox Reactions Past Questions',             description:'JAMB & WAEC past questions on redox.',                                   file_url:'/uploads/chemistry_redox_pq.pdf',       file_type:'pdf', resource_type:'pq' },
    { subject:'Chemistry', topic:'bonding',         title:'Chemical Bonding SCOT Note',                 description:'Ionic, covalent, metallic bonding, VSEPR theory.',                       file_url:'/uploads/chemistry_bonding_note.pdf',   file_type:'pdf', resource_type:'note' },
    { subject:'Biology',   topic:'cell-biology',    title:'Cell Biology SCOT Note',                     description:'Cell structure, organelles, cell division, membrane transport.',         file_url:'/uploads/biology_cell_note.pdf',        file_type:'pdf', resource_type:'note' },
    { subject:'Biology',   topic:'cell-biology',    title:'Cell Biology Past Questions',                description:'JAMB & WAEC past questions on cell biology.',                            file_url:'/uploads/biology_cell_pq.pdf',          file_type:'pdf', resource_type:'pq' },
    { subject:'Biology',   topic:'genetics',        title:'Genetics SCOT Note',                         description:'Mendelian genetics, DNA, mutations, inheritance patterns.',               file_url:'/uploads/biology_genetics_note.pdf',    file_type:'pdf', resource_type:'note' },
    { subject:'English',   topic:'figures-of-speech', title:'Figures of Speech SCOT Note',             description:'50 figures of speech with definitions and examples.',                    file_url:'/uploads/english_figures_note.pdf',     file_type:'pdf', resource_type:'note' },
    { subject:'English',   topic:'figures-of-speech', title:'Figures of Speech Past Questions',        description:'WAEC & JAMB comprehension and figures of speech questions.',              file_url:'/uploads/english_figures_pq.pdf',       file_type:'pdf', resource_type:'pq' },
    { subject:'English',   topic:'grammar',         title:'Grammar & Structure SCOT Note',              description:'Parts of speech, sentence structure, tenses, voice.',                    file_url:'/uploads/english_grammar_note.pdf',     file_type:'pdf', resource_type:'note' },
  ]);
}
