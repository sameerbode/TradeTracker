#!/bin/bash
ssh sameerbodepudi@100.117.41.42 "cd ~/TradeTracker && git pull && pm2 restart all"
