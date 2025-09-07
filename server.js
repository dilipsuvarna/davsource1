const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs-extra');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;
const DATA_FILE = path.join(__dirname, 'data.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

app.use(cors());
app.use(bodyParser.json());

// Ensure data file exists with default structure
async function ensureDataFile() {
  const defaultData = {
    toc: { name: 'Theory of Computation', links: [] },
    ai: { name: 'Artificial Intelligence', links: [] },
    sepm: { name: 'Software Engineering Project Management', links: [] },
    cn: { name: 'Computer Networks', links: [] },
    rm: { name: 'Research Methodology', links: [] }
  };
  if (!(await fs.pathExists(DATA_FILE))) {
    await fs.writeJson(DATA_FILE, defaultData, { spaces: 2 });
  }
}

async function readData() {
  await ensureDataFile();
  return fs.readJson(DATA_FILE);
}

async function writeData(data) {
  return fs.writeJson(DATA_FILE, data, { spaces: 2 });
}

// Mongo models (optional)
let LinkModel = null;
let SubjectModel = null;

const linkSchema = new mongoose.Schema({
  subjectKey: { type: String, required: true, index: true },
  title: { type: String, required: true },
  url: { type: String, required: true },
  addedBy: { type: String, default: 'admin' },
  addedAt: { type: Date, default: Date.now }
});

const subjectSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true }
});

async function initMongo() {
  if (!MONGODB_URI) return false;
  try {
    await mongoose.connect(MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });
    LinkModel = mongoose.model('Link', linkSchema);
    SubjectModel = mongoose.model('Subject', subjectSchema);
    // Seed subjects if empty
    const count = await SubjectModel.countDocuments();
    if (count === 0) {
      await SubjectModel.insertMany([
        { key: 'toc', name: 'Theory of Computation' },
        { key: 'ai', name: 'Artificial Intelligence' },
        { key: 'sepm', name: 'Software Engineering Project Management' },
        { key: 'cn', name: 'Computer Networks' },
        { key: 'rm', name: 'Research Methodology' }
      ]);
    }
    return true;
  } catch (err) {
    console.error('Mongo connection failed, falling back to file storage.', err.message);
    return false;
  }
}

let mongoReady = false;

// API routes
app.get('/api/subjects', async (req, res) => {
  try {
    if (mongoReady && SubjectModel) {
      const subjects = await SubjectModel.find().lean();
      const result = subjects.reduce((acc, s) => {
        acc[s.key] = { name: s.name };
        return acc;
      }, {});
      return res.json(result);
    }
    const data = await readData();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read data' });
  }
});

app.get('/api/subjects/:key/links', async (req, res) => {
  try {
    if (mongoReady && LinkModel) {
      const links = await LinkModel.find({ subjectKey: req.params.key }).sort({ addedAt: -1 }).lean();
      return res.json(links);
    }
    const data = await readData();
    const subject = data[req.params.key];
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    res.json(subject.links);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read links' });
  }
});

app.post('/api/subjects/:key/links', async (req, res) => {
  try {
    const { title, url, addedBy } = req.body || {};
    if (!title || !url) return res.status(400).json({ error: 'Missing title or url' });
    if (mongoReady && LinkModel) {
      const exists = SubjectModel ? await SubjectModel.exists({ key: req.params.key }) : true;
      if (!exists) return res.status(404).json({ error: 'Subject not found' });
      const newLink = await LinkModel.create({ subjectKey: req.params.key, title, url, addedBy: addedBy || 'admin' });
      return res.status(201).json(newLink);
    }
    const data = await readData();
    if (!data[req.params.key]) return res.status(404).json({ error: 'Subject not found' });
    const newLink = { title, url, addedBy: addedBy || 'admin', addedAt: new Date().toISOString() };
    data[req.params.key].links.push(newLink);
    await writeData(data);
    res.status(201).json(newLink);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add link' });
  }
});

app.delete('/api/subjects/:key/links/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (mongoReady && LinkModel) {
      // For Mongo, index represents order by addedAt desc; delete the matching document
      const items = await LinkModel.find({ subjectKey: req.params.key }).sort({ addedAt: -1 }).lean();
      if (Number.isNaN(index) || index < 0 || index >= items.length) {
        return res.status(400).json({ error: 'Invalid link index' });
      }
      const target = items[index];
      await LinkModel.deleteOne({ _id: target._id });
      return res.json(target);
    }
    const data = await readData();
    const subject = data[req.params.key];
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    if (Number.isNaN(index) || index < 0 || index >= subject.links.length) {
      return res.status(400).json({ error: 'Invalid link index' });
    }
    const [removed] = subject.links.splice(index, 1);
    await writeData(data);
    res.json(removed);
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Serve static frontend
app.use(express.static(__dirname));

app.listen(PORT, async () => {
  await ensureDataFile();
  mongoReady = await initMongo();
  console.log(`Server listening on http://localhost:${PORT}${mongoReady ? ' (with MongoDB)' : ' (file storage)'}`);
});


