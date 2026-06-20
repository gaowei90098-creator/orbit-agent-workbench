#!/usr/bin/env node
process.stdin.on("data", function(c){process.stdout.write("echo:"+c.toString());});
process.stdin.on("end", function(){process.exit(0);});
process.stdout.write("READY");
