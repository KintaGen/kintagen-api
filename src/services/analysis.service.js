// src/services/analysis.service.js
import { spawn } from 'child_process';

/**
 * A helper function to run external scripts as a promise.
 * @param {string} command The command to run (e.g., 'Rscript').
 * @param {string[]} args An array of arguments for the command.
 * @param {object} [options={}] Options for the child process (e.g., { cwd: '/path/to/dir' }).
 * @returns {Promise<string>} A promise that resolves with the script's stdout.
 */
export function runScript(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`Spawning: ${command} ${args.join(' ')}`);
        const process = spawn(command, args, options);
  
        let stdout = '';
        let stderr = '';
  
        process.stdout.on('data', (data) => {
            console.log(`[${command} stdout]: ${data}`);
            stdout += data.toString();
        });
  
        process.stderr.on('data', (data) => {
            console.error(`[${command} stderr]: ${data}`);
            stderr += data.toString();
        });
  
        process.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`Process ${command} exited with code ${code}\n${stderr}`));
            }
            resolve(stdout);
        });
  
        process.on('error', (err) => {
            reject(err);
        });
    });
}