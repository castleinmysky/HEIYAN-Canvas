import { createCanvasServer, deploymentOptions } from "./http-app.js";

const options = deploymentOptions();
const app = createCanvasServer(options);
let vite;
if (process.argv.includes("--dev")) {
  if (
    !["127.0.0.1", "localhost", "::1"].includes(options.host) ||
    options.origin ||
    options.password
  )
    throw Error(
      "Development mode is loopback-only. Use npm run build and npm start for deployment.",
    );
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true, hmr: { server: app.server } },
  });
  app.setMiddleware(vite.middlewares);
}
app.server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "端口已被占用，请修改 HEIYAN_PORT；不会关闭其他程序。"
      : "画布服务启动失败。",
  );
  process.exitCode = 1;
});
app.server.listen(options.port, options.host, () =>
  console.log(
    `HEIYAN 黑岩画布\n${options.origin || `http://${options.host}:${options.port}`}\n数据保存在当前浏览器；关闭窗口前请导出重要内容。`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await vite?.close();
    app.server.close(() => process.exit(0));
    app.server.closeIdleConnections();
  });
