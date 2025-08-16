import { transformAsync } from "@babel/core";
// @ts-expect-error - Types not important.
import ts from "@babel/preset-typescript";
// @ts-expect-error - Types not important.
import solid from "babel-preset-solid";
import { plugin, type BunPlugin } from "bun";

const solidTransformPlugin: BunPlugin = {
  name: "bun-plugin-solid",
  setup: (build) => {
    // build.onLoad({ filter: /\.(js|ts)$/ }, async (args) => {
    //   const { readFile } = await import("node:fs/promises");
    //   const code = await readFile(args.path, "utf8");
    //   const transforms = await transformAsync(code, {
    //     filename: args.path,
    //     plugins: [
    //       [
    //         "module-resolver",
    //         {
    //           alias: {
    //             "^solid-js$": "solid-js/dist/solid.js",
    //           },
    //         },
    //       ],
    //     ],
    //     presets: [
    //       [ts, {}],
    //     ],
    //   });
    //   return {
    //     contents: transforms.code,
    //     loader: "js",
    //   };
    // });
    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      const code = await readFile(args.path, "utf8");
      const transforms = await transformAsync(code, {
        filename: args.path,
        plugins: [
          [
            "module-resolver",
            {
              alias: {
                "^solid-js$": "solid-js/dist/solid.js",
              },
            },
          ],
        ],
        presets: [
          [
            solid,
            {
              moduleName: "@opentui/solid/reconciler",
              generate: "universal",
            },
          ],
          [ts, {}],
        ],
      });
      return {
        contents: transforms.code,
        loader: "js",
      };
    });
  },
};

plugin(solidTransformPlugin);
