/*const{ App, SocketModeReceiver } = require('@slack/bolt')
require('dotenv').config()
const axios = require('axios')
const OpenAI = require('openai')
const fs = require('fs')
const path = require('path')
const QuickChart = require('quickchart-js');

/**
 * Generate a chart image buffer
 * @param {Object} config
 * @param {Array} config.labels
 * @param {Array} config.datasets
 * @param {String} config.type (bar, line, radar, etc.)
 */
/*async function generateGraph({ labels, datasets, type = 'bar' }) {
  const chart = new QuickChart();

  chart.setConfig({
    type,
    data: { labels, datasets},
    options: {
      responsive: true,
      plugins: { legend: { display: true }
      },
      scales: { y: { beginAtZero: true }}
    }
  });

  chart.setWidth(1000);
  chart.setHeight(600);
  chart.setBackgroundColor('white');  

  return await chart.toBinary();
}

module.exports = { generateGraph };

// datasetBuilder.js

function calculateMetric(record, metric) {
  switch (metric) {
    case 'winRate':
      return record.wins / (record.wins + record.losses);
    case 'opr':
      return record.opr;
    case 'avgScore':
      return record.avgScore;
    default:
      return record[metric];
  }
}

/**
 * Build dataset dynamically
 * @param {Object} query
 * @param {Array} database
 */
/*function buildDataset(query, database) {
  const { teams, seasons, events, metric, groupBy } = query;

  let filtered = database.filter(r =>
    (!teams || teams.includes(r.team)) &&
    (!seasons || seasons.includes(r.season)) &&
    (!events || events.includes(r.event))
  );

  // Grouping logic
  const grouped = {};

  filtered.forEach(record => {
    let key;

    if (groupBy === 'season') key = record.season;
    else if (groupBy === 'event') key = record.event;
    else key = record.team;

    if (!grouped[key]) grouped[key] = [];

    grouped[key].push(calculateMetric(record, metric));
  });

  const labels = Object.keys(grouped);

  const datasets = [{
    label: metric,
    data: labels.map(label => {
      const values = grouped[label];
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      return Number(avg.toFixed(3));
    })
  }];

  return { labels, datasets };
}

module.exports = { buildDataset };*/