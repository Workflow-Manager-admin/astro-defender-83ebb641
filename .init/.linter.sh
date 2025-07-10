#!/bin/bash
cd /home/kavia/workspace/code-generation/astro-defender-83ebb641/astronaut_pixel_game_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

